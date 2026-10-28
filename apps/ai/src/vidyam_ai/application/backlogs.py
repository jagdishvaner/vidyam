"""The content pipeline's model work, run as backlogs (plan v3 §5 and §8): reading scanned pages (OCR),
splitting question papers into questions, and picking syllabus topics for chunks and questions.

Each backlog is estimated first and runs only when an admin starts it; nothing paid starts by itself. Requests
go through the Batch APIs at half price, and the results come back through the batch handlers here, which the
LlmBatch workflow calls once a batch has finished.
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import Literal, Protocol
from uuid import UUID

from vidyam_ai.application.llm_gateway import (
    BatchItem,
    BatchOutcome,
    BatchRecord,
    Caller,
    LlmError,
    LlmGateway,
    output_schema,
    parse_structured,
)
from vidyam_ai.domain.chunking import estimate_tokens
from vidyam_ai.domain.llm import Image, Segment, Usage
from vidyam_ai.domain.papers import PaperPage, Window, windows
from vidyam_ai.domain.sections import SyllabusNode
from vidyam_ai.generated.contracts import OcrPage, SegmentedPaper, SegmentedQuestion, TopicTags

BacklogKind = Literal["ocr", "segment", "tag"]
TASKS: Mapping[BacklogKind, str] = {"ocr": "ocr_text", "segment": "segment", "tag": "tag"}

# Request sizes for estimates. Deliberately generous until Phase B measures real ones on the demo pack.
OCR_INPUT_TOKENS = 2_100  # a page image (about 1,600 tokens) and the prompt
OCR_OUTPUT_TOKENS = 2_500  # a dense page of Hindi, as Markdown in JSON
SEGMENT_PROMPT_TOKENS = 700
SEGMENT_OUTPUT_FACTOR = 1.3  # the questions are the window's text again, with JSON around it
TAG_PROMPT_TOKENS = 300
TAG_OUTPUT_TOKENS = 250

BATCH_IMAGES = 200  # page images per batch: about 60 MB, well under both providers' request size limits
BATCH_REQUESTS = 5_000

LANGUAGES = {"hi": "Hindi", "en": "English", "mixed": "Hindi and English"}


@dataclass(frozen=True)
class OcrJob:
    page_id: UUID
    source_id: UUID
    page_no: int
    label: str | None
    image_key: str
    title: str
    language: str | None


@dataclass(frozen=True)
class PaperJob:
    source_id: UUID
    title: str
    set_code: str | None
    pages: Sequence[PaperPage]


@dataclass(frozen=True)
class TagJob:
    item: Literal["chunk", "question"]
    id: UUID
    tokens: int
    scope_id: UUID  # candidates are this node's descendants (the item's chapter, or its subject)
    text: str = ""
    heading_path: str | None = None


@dataclass(frozen=True)
class TopicResult:
    item: Literal["chunk", "question"]
    id: UUID
    tags: Sequence[tuple[str, float]]  # (code path, confidence)


@dataclass(frozen=True)
class Provenance:
    """Which model call produced a result, kept with it."""

    provider: str
    model_id: str
    prompt_version: str
    batch_id: UUID | None


class BacklogStore(Protocol):
    """Port: what each backlog works on, and where its results go (Postgres, scoped to the organization)."""

    async def ocr_jobs(self, org_id: UUID, limit: int | None) -> list[OcrJob]: ...
    async def paper_jobs(self, org_id: UUID, limit: int | None) -> list[PaperJob]: ...
    async def tag_jobs(self, org_id: UUID, limit: int | None, *, with_text: bool) -> list[TagJob]: ...
    async def save_ocr(self, org_id: UUID, page_id: UUID, page: OcrPage, made_by: Provenance) -> UUID | None:
        """Stores a page's text; returns its source when the page became readable."""
        ...

    async def save_questions(
        self, org_id: UUID, source_id: UUID, questions: Sequence[SegmentedQuestion], made_by: Provenance
    ) -> int: ...
    async def save_topic_tags(self, org_id: UUID, results: Sequence[TopicResult], tagger: str) -> int:
        """Stores the topics picked for each item (only nodes under the item's own chapter or subject count),
        and marks every item as checked, even when nothing fitted. Returns how many tags were stored."""
        ...


class Syllabus(Protocol):
    async def nodes(self, org_id: UUID) -> list[SyllabusNode]: ...


class PageImageReader(Protocol):
    async def read(self, key: str) -> bytes: ...


@dataclass(frozen=True)
class Estimate:
    kind: BacklogKind
    items: int
    requests: int
    model_id: str | None
    provider: str | None
    cost_usd: Decimal
    blocked: str | None


@dataclass(frozen=True)
class Submitted:
    items: int
    batch_ids: list[UUID]
    sources: list[UUID]  # files whose pages are being read (OCR): they are re-chunked afterwards


def _candidates(scope: SyllabusNode, nodes: Sequence[SyllabusNode]) -> str:
    """The syllabus under a chapter (or subject) as the tag task's candidate list. It is the same for every
    item in that chapter, so it is cached and paid for once per hour, not per item."""
    lines = [
        " | ".join([node.path, node.name_en, node.name_hi or "", ", ".join(node.aliases)])
        for node in nodes
        if node.path.startswith(f"{scope.path}/")
    ]
    title = f"Syllabus candidates under {scope.name_en} ({scope.path}):"
    return "\n".join([title, *lines])


def _custom_id(prefix: str, value: UUID, suffix: str = "") -> str:
    return f"{prefix}-{value.hex}{suffix}"


def _uuid_of(custom_id: str) -> UUID:
    return UUID(custom_id.split("-")[1])


class Backlogs:
    def __init__(
        self, gateway: LlmGateway, store: BacklogStore, syllabus: Syllabus, images: PageImageReader
    ) -> None:
        self._gateway = gateway
        self._store = store
        self._syllabus = syllabus
        self._images = images

    # --- What each backlog holds, and what running it would cost -------------------------------------

    async def estimate(self, org_id: UUID, kind: BacklogKind) -> Estimate:
        usages: list[Usage]
        if kind == "ocr":
            jobs = await self._store.ocr_jobs(org_id, None)
            items = len(jobs)
            usages = [Usage(input_tokens=OCR_INPUT_TOKENS, output_tokens=OCR_OUTPUT_TOKENS)] * items
        elif kind == "segment":
            papers = await self._store.paper_jobs(org_id, None)
            items = len(papers)
            usages = [
                Usage(
                    input_tokens=SEGMENT_PROMPT_TOKENS + (text := estimate_tokens(window.text)),
                    output_tokens=math.ceil(text * SEGMENT_OUTPUT_FACTOR),
                )
                for paper in papers
                for window in windows(paper.pages)
            ]
        else:
            jobs = await self._store.tag_jobs(org_id, None, with_text=False)
            items = len(jobs)
            nodes = await self._syllabus.nodes(org_id)
            sizes = {
                node.id: estimate_tokens(_candidates(node, nodes))
                for node in nodes
                if node.id in {j.scope_id for j in jobs}
            }
            seen: set[UUID] = set()
            usages = []
            for job in jobs:
                # The candidate list is written to the cache once per chapter, then read from it.
                first = job.scope_id not in seen
                seen.add(job.scope_id)
                candidates = sizes.get(job.scope_id, 0)
                usages.append(
                    Usage(
                        input_tokens=TAG_PROMPT_TOKENS + job.tokens,
                        cache_write_1h_tokens=candidates if first else 0,
                        cache_read_tokens=0 if first else candidates,
                        output_tokens=TAG_OUTPUT_TOKENS,
                    )
                )
        if not usages:
            return Estimate(kind, items, 0, None, None, Decimal(0), None)
        try:
            cost = await self._gateway.estimate(org_id, TASKS[kind], usages)
        except LlmError as error:
            return Estimate(kind, items, len(usages), None, None, Decimal(0), str(error))
        return Estimate(kind, items, len(usages), cost.model_id, cost.provider, cost.cost_usd, None)

    # --- Submitting ----------------------------------------------------------------------------------

    async def submit(self, caller: Caller, kind: BacklogKind, limit: int | None) -> Submitted:
        if kind == "ocr":
            return await self._submit_ocr(caller, limit)
        if kind == "segment":
            return await self._submit_papers(caller, limit)
        return await self._submit_tags(caller, limit)

    async def _submit_ocr(self, caller: Caller, limit: int | None) -> Submitted:
        jobs = await self._store.ocr_jobs(caller.org_id, limit)
        batch_ids: list[UUID] = []
        for start in range(0, len(jobs), BATCH_IMAGES):
            items = [
                BatchItem(
                    _custom_id("p", job.page_id),
                    {
                        "file_title": job.title,
                        "language": LANGUAGES.get(job.language or "", "Hindi or English"),
                        "page": job.label or str(job.page_no),
                    },
                    images=[Image("image/png", await self._images.read(job.image_key))],
                )
                for job in jobs[start : start + BATCH_IMAGES]
            ]
            batch_ids.append(
                await self._gateway.submit_batch(caller, TASKS["ocr"], items, output=output_schema(OcrPage))
            )
        return Submitted(len(jobs), batch_ids, sorted({job.source_id for job in jobs}))

    async def _submit_papers(self, caller: Caller, limit: int | None) -> Submitted:
        papers = await self._store.paper_jobs(caller.org_id, limit)
        items: list[BatchItem] = []
        for paper in papers:
            for n, window in enumerate(windows(paper.pages)):
                items.append(self._paper_item(paper, n, window))
        batch_ids = [
            await self._gateway.submit_batch(
                caller,
                TASKS["segment"],
                items[start : start + BATCH_REQUESTS],
                output=output_schema(SegmentedPaper),
            )
            for start in range(0, len(items), BATCH_REQUESTS)
        ]
        return Submitted(len(papers), batch_ids, [])

    @staticmethod
    def _paper_item(paper: PaperJob, n: int, window: Window) -> BatchItem:
        return BatchItem(
            _custom_id("s", paper.source_id, f"-{n}"),
            {
                "paper_title": paper.title,
                "booklet_set": paper.set_code or "not printed",
                "first_page": str(window.first_page),
                "last_page": str(window.last_page),
                "text": window.text,
            },
        )

    async def _submit_tags(self, caller: Caller, limit: int | None) -> Submitted:
        jobs = await self._store.tag_jobs(caller.org_id, limit, with_text=True)
        nodes = await self._syllabus.nodes(caller.org_id)
        by_id = {node.id: node for node in nodes}
        candidates = {
            scope: _candidates(by_id[scope], nodes)
            for scope in {job.scope_id for job in jobs}
            if scope in by_id
        }
        items = [
            BatchItem(
                _custom_id("c" if job.item == "chunk" else "q", job.id),
                {
                    "kind": "passage" if job.item == "chunk" else "question",
                    "heading_path": job.heading_path or "(no headings)",
                    "text": job.text,
                },
                context=[Segment(candidates[job.scope_id], "1h")],
            )
            for job in jobs
            if job.scope_id in candidates
        ]
        batch_ids = [
            await self._gateway.submit_batch(
                caller, TASKS["tag"], items[start : start + BATCH_REQUESTS], output=output_schema(TopicTags)
            )
            for start in range(0, len(items), BATCH_REQUESTS)
        ]
        return Submitted(len(items), batch_ids, [])

    # --- Storing results (batch handlers) ------------------------------------------------------------

    @staticmethod
    def _provenance(batch: BatchRecord) -> Provenance:
        return Provenance(batch.provider, batch.model_id, batch.prompt_version, batch.id)

    async def store_ocr(self, batch: BatchRecord, outcomes: Sequence[BatchOutcome]) -> None:
        made_by = self._provenance(batch)
        for outcome in outcomes:
            if outcome.reply is None:
                continue  # failed requests stay in the backlog for the next run
            page = parse_structured(outcome.reply.text, OcrPage)
            await self._store.save_ocr(batch.caller.org_id, _uuid_of(outcome.custom_id), page, made_by)

    async def store_questions(self, batch: BatchRecord, outcomes: Sequence[BatchOutcome]) -> None:
        made_by = self._provenance(batch)
        by_paper: dict[UUID, list[SegmentedQuestion]] = {}
        failed: set[UUID] = set()
        for outcome in sorted(
            outcomes, key=lambda o: (o.custom_id.split("-")[1], int(o.custom_id.split("-")[2]))
        ):
            paper = _uuid_of(outcome.custom_id)
            if outcome.reply is None:
                failed.add(paper)
                continue
            by_paper.setdefault(paper, []).extend(
                parse_structured(outcome.reply.text, SegmentedPaper).questions
            )
        for paper, questions in by_paper.items():
            if paper not in failed:  # a paper with a failed window is split again on the next run
                await self._store.save_questions(batch.caller.org_id, paper, questions, made_by)

    async def store_topic_tags(self, batch: BatchRecord, outcomes: Sequence[BatchOutcome]) -> None:
        results = [
            TopicResult(
                "chunk" if outcome.custom_id.startswith("c-") else "question",
                _uuid_of(outcome.custom_id),
                [
                    (tag.node.root, tag.confidence)
                    for tag in parse_structured(outcome.reply.text, TopicTags).tags
                ],
            )
            for outcome in outcomes
            if outcome.reply is not None  # failed requests stay in the backlog for the next run
        ]
        await self._store.save_topic_tags(batch.caller.org_id, results, batch.prompt_version)
