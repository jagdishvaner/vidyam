"""Making what a teacher confirmed (plan v3 §7, step 26): question papers and worksheets, notes and
revision sheets. Each use case here is one step of the GeneratePaper or GenerateNotes workflow; the workflow
runs them in order, retries them, and commits results through the API (ADR 0017). Questions go into the
center's bank as they are written, so a paper's questions outlive the paper.

A paper:

1. **Plan** (`PlanPaper`): one slot per question, by the exam's weightage and the difficulty mix, then fill
   what the bank can (approved questions first, then verified ones; none twice, none these students saw).
2. **Write** (`WriteQuestions`), up to five questions of one chapter and type per call: evidence from the
   chapter's material, the teacher's model writes them citing it, then the fast checks in code and a grounding
   check by a model. A slot with no material is marked so; nothing is invented.
3. **Check answers** (`CheckAnswers`): a model of the other provider solves each question blind, each language
   version on its own; a different answer flags the question.
4. Failed questions are written again (twice) with what was wrong, then left flagged for the teacher.
5. **Assemble** (`AssemblePaper`): sections, booklet sets and their keys.

Notes take one section per chapter (or per topic, for standard and detailed notes), each written from the
chapter's material with citations and checked for grounding.
"""

import asyncio
import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import PurePosixPath
from typing import Any, Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from vidyam_ai.application.chat import ChatModels, Searcher, evidence, renumber
from vidyam_ai.application.llm_gateway import Caller, InvalidOutput, LlmRequest
from vidyam_ai.application.retrieval import Hit, RetrievalRequest
from vidyam_ai.domain.generation import (
    NO_BANK,
    NO_EVIDENCE,
    NUMERIC_TYPES,
    OPTION_TYPES,
    Slot,
    answers_agree,
    assemble,
    check_question,
    plan_slots,
    shown,
)
from vidyam_ai.domain.llm import Segment, Turn
from vidyam_ai.domain.retrieval import Scope
from vidyam_ai.domain.specs import type_name
from vidyam_ai.generated.contracts import NotesDocument, PaperDocument

log = logging.getLogger(__name__)

EVIDENCE = 8  # passages per call
SOLVING = 4  # questions re-solved at once
NOTES_SECTIONS = 24  # at most, however many topics the chapters have
GENERATION_TAGGER = "generation-v1"


# --- Ports ---------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Run:
    """A confirmed spec being made (generation_runs with its document)."""

    id: UUID
    document_id: UUID
    session_id: UUID | None
    workflow_id: str
    kind: str
    title: str
    spec: dict[str, Any]
    exam_id: UUID | None
    owner_id: UUID
    locale: str  # the owner's interface language, for the chat's message


@dataclass(frozen=True)
class Node:
    id: str
    name_en: str
    name_hi: str | None
    path: str  # code path, "science/physics/motion"

    def name(self, languages: Sequence[str]) -> str:
        if self.name_hi and "hi" in languages and "en" not in languages:
            return self.name_hi
        return f"{self.name_en} / {self.name_hi}" if self.name_hi else self.name_en


@dataclass(frozen=True)
class BankQuestion:
    id: UUID
    difficulty: int | None


@dataclass(frozen=True)
class NewQuestion:
    qtype: str
    status: str  # draft (checks passed so far) or flagged
    content: dict[str, Any]  # QuestionContent
    answer: dict[str, Any]  # Answer
    language: str  # authoritative
    marks: float
    negative_marks: float
    difficulty: int
    node_id: str
    exam_id: UUID | None
    provenance: dict[str, Any]
    verification: dict[str, Any]
    created_by: UUID | None


class GenerationStore(Protocol):
    """Port: runs, the syllabus and the question bank (Postgres, under the center's row-level security)."""

    async def run(self, org_id: UUID, run_id: UUID) -> Run | None: ...
    async def weights(self, org_id: UUID, exam_id: UUID | None, node_ids: Sequence[str]) -> dict[str, float]:
        """The exam's weightage of each node, where it has one."""
        ...

    async def nodes(self, org_id: UUID, ids: Sequence[str]) -> dict[str, Node]: ...
    async def children(self, org_id: UUID, node_id: str) -> list[Node]:
        """A node's active children, in syllabus order."""
        ...

    async def bank(
        self,
        org_id: UUID,
        node_id: str,
        qtype: str,
        languages: Sequence[str],
        *,
        exclude: Sequence[UUID],
        student_batch_id: UUID | None,
        limit: int,
    ) -> list[BankQuestion]:
        """Approved, then verified, questions of this type under the node (its topics included) with every
        language the paper needs, least used first."""
        ...

    async def glossary(self, org_id: UUID, node_ids: Sequence[str]) -> list[tuple[str, str]]:
        """Approved (English, Hindi) terms of the nodes' subjects."""
        ...

    async def save_question(self, org_id: UUID, question: NewQuestion) -> UUID:
        """The question and its tag (method "generation"). Earlier questions for the same slot of the same run
        (a flagged one being replaced) are retired."""
        ...

    async def questions(self, org_id: UUID, ids: Sequence[UUID]) -> dict[str, dict[str, Any]]:
        """By id: qtype, content, answer, provenance."""
        ...

    async def checked(
        self, org_id: UUID, question_id: UUID, status: str, verification: Mapping[str, Any]
    ) -> None:
        """A question's status after the answer check, with the check's findings."""
        ...

    async def file_names(self, org_id: UUID, source_ids: Sequence[UUID]) -> dict[UUID, str]: ...
    async def passages(self, org_id: UUID, chunk_ids: Sequence[str]) -> list[str]:
        """The chunks' text with their headings, in the order asked for."""
        ...

    async def cost(self, org_id: UUID, workflow_id: str) -> Decimal:
        """What the run's model calls cost so far (the usage ledger)."""
        ...


# --- Model outputs -------------------------------------------------------------------------------------


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class WrittenOption(_Strict):
    key: str
    text: str


class WrittenVersion(_Strict):
    stem: str
    options: list[WrittenOption]
    solution: str


class WrittenQuestion(_Strict):
    slot: str
    hi: WrittenVersion | None
    en: WrittenVersion | None
    correct: list[str]  # option keys, for option types
    value: float | None  # numeric and integer types
    model_answer: str | None  # short and long answers
    cites: list[int]  # passage numbers


class WrittenBatch(_Strict):
    """The `generate` task's structured output."""

    questions: list[WrittenQuestion]


class Verdict(_Strict):
    item: str
    supported: bool
    problem: str | None


class Grounding(_Strict):
    """The `verify_grounding` task's structured output."""

    verdicts: list[Verdict]


class Solution(_Strict):
    """The `verify_solve` task's structured output."""

    keys: list[str]
    value: float | None
    working: str


class NotesWritten(_Strict):
    """The `notes_write` task's structured output: Markdown per language, citing passages as [n]."""

    hi: str | None
    en: str | None
    cites: list[int]


# --- Requests and results ------------------------------------------------------------------------------


@dataclass(frozen=True)
class Job:
    """Who a step works for: every model call it makes is billed to the run."""

    org_id: UUID
    run_id: UUID
    requested_by: UUID | None
    model_id: str | None  # the teacher's choice for writing


@dataclass(frozen=True)
class Written:
    """What writing one group produced: each slot as it now stands, the evidence used, and who wrote it."""

    slots: list[Slot]
    chunk_ids: list[str] = field(default_factory=list[str])
    model_id: str | None = None


def _caller(job: Job, run: Run) -> Caller:
    return Caller(
        job.org_id, user_id=job.requested_by, document_id=run.document_id, workflow_id=run.workflow_id
    )


def _languages(spec: Mapping[str, Any]) -> list[str]:
    return [lang for lang in ("hi", "en") if lang in spec.get("languages", [])] or ["hi"]


def _preferred(languages: Sequence[str]) -> str | None:
    return languages[0] if len(languages) == 1 else None


def _language_names(languages: Sequence[str]) -> str:
    names = {"hi": "Hindi (Devanagari)", "en": "English"}
    return " and ".join(names[lang] for lang in languages)


async def _evidence(
    search: Searcher, org_id: UUID, node: Node, languages: Sequence[str], used: Sequence[str]
) -> list[Hit]:
    found = await search.execute(
        RetrievalRequest(
            org_id,
            node.name_en + (f" {node.name_hi}" if node.name_hi else ""),
            scope=Scope(node_ids=(UUID(node.id),), exclude_chunk_ids=tuple(UUID(c) for c in used)),
            limit=EVIDENCE,
            language=_preferred(languages),
            min_relevance=0.0,  # the chapter's own material, however its words match the chapter's name
        )
    )
    return list(found.hits)


def _numbers(cites: Sequence[int], count: int) -> list[int]:
    return list(dict.fromkeys(n for n in cites if 1 <= n <= count))


# --- Papers --------------------------------------------------------------------------------------------


def fill_from_bank(slots: Sequence[Slot], found: Sequence[BankQuestion]) -> list[Slot]:
    """Each slot takes the bank question nearest its difficulty; slots left over stay as they are."""
    left = list(found)
    out: list[Slot] = []
    for slot in slots:
        if not left:
            out.append(slot)
            continue
        best = min(left, key=lambda q: abs((q.difficulty or slot["difficulty"]) - slot["difficulty"]))
        left.remove(best)
        out.append({**slot, "state": "bank", "questionId": str(best.id)})
    return out


class PlanPaper:
    def __init__(self, store: GenerationStore) -> None:
        self._store = store

    async def execute(self, org_id: UUID, run_id: UUID) -> list[Slot]:
        run = await _run(self._store, org_id, run_id)
        spec = run.spec
        nodes = await self._store.nodes(org_id, spec["taxonomyNodeIds"])
        weights = await self._store.weights(org_id, run.exam_id, spec["taxonomyNodeIds"])
        slots = plan_slots(spec, weights, {node_id: node.path for node_id, node in nodes.items()})
        if spec["sourcing"] == "fresh_only":
            return slots
        taken: list[UUID] = []
        by_kind: dict[tuple[str, str], list[Slot]] = {}
        for slot in slots:
            by_kind.setdefault((slot["taxonomyNodeId"], slot["qtype"]), []).append(slot)
        filled: dict[str, Slot] = {}
        for (node, qtype), members in by_kind.items():
            found = await self._store.bank(
                org_id,
                node,
                qtype,
                _languages(spec),
                exclude=taken,
                student_batch_id=UUID(spec["studentBatchId"]) if spec.get("studentBatchId") else None,
                limit=len(members) * 3,
            )
            for slot in fill_from_bank(members, found):
                filled[slot["slotId"]] = slot
                if slot["questionId"]:
                    taken.append(UUID(slot["questionId"]))
        out = [filled[slot["slotId"]] for slot in slots]
        if spec["sourcing"] == "bank_only":
            out = [
                slot
                if slot["state"] == "bank"
                else {**slot, "state": "insufficient_evidence", "flags": [NO_BANK]}
                for slot in out
            ]
        return out


async def _run(store: GenerationStore, org_id: UUID, run_id: UUID) -> Run:
    run = await store.run(org_id, run_id)
    if run is None:
        raise LookupError(f"no generation run {run_id}")
    return run


_DIFFICULTY = {1: "very easy", 2: "easy", 3: "medium", 4: "hard", 5: "very hard"}


def _slot_lines(slots: Sequence[Slot]) -> str:
    return "\n".join(
        f'- slot "{slot["slotId"]}": {type_name(slot["qtype"], "en")} ({slot["qtype"]}), '
        f"difficulty {slot['difficulty']} of 5 ({_DIFFICULTY[slot['difficulty']]}), {slot['marks']:g} marks"
        for slot in slots
    )


def _content(written: WrittenQuestion, qtype: str, languages: Sequence[str]) -> dict[str, Any]:
    def version(v: WrittenVersion | None) -> dict[str, Any] | None:
        if v is None or not v.stem.strip():
            return None
        options = [{"key": o.key.strip(), "text": o.text} for o in v.options] if qtype in OPTION_TYPES else []
        return {"stem": v.stem, "options": options, "solution": v.solution or None}

    return {lang: version(getattr(written, lang)) if lang in languages else None for lang in ("hi", "en")}


def _answer(written: WrittenQuestion, qtype: str) -> dict[str, Any]:
    if qtype in OPTION_TYPES:
        keys = [key.strip() for key in written.correct if key.strip()]
        return {"kind": "options", "keys": keys} if keys else {"kind": "unknown"}
    if qtype in NUMERIC_TYPES:
        if written.value is None:
            return {"kind": "unknown"}
        tolerance = 0.0 if qtype == "integer" else round(abs(written.value) * 0.01, 6)
        return {"kind": "numeric", "value": written.value, "tolerance": tolerance}
    return {"kind": "text", "modelAnswer": written.model_answer or ""}


def _printed(content: Mapping[str, Any], answer: Mapping[str, Any] | None) -> str:
    """One version of a question as a checker reads it (English when there is one)."""
    version: Mapping[str, Any] = content.get("en") or content.get("hi") or {}
    options: list[dict[str, str]] = version.get("options", [])
    lines = [f"Question: {version.get('stem', '')}"]
    lines += [f"{o['key']}) {o['text']}" for o in options]
    if answer is not None:
        lines.append(
            f"Answer: {answer.get('modelAnswer') if answer.get('kind') == 'text' else shown(answer)}"
        )
        if version.get("solution"):
            lines.append(f"Solution: {version['solution']}")
    return "\n".join(lines)


class WriteQuestions:
    def __init__(self, store: GenerationStore, models: ChatModels, search: Searcher) -> None:
        self._store = store
        self._models = models
        self._search = search

    async def execute(
        self,
        job: Job,
        slots: Sequence[Slot],
        *,
        used: Sequence[str],
        feedback: Mapping[str, Sequence[str]],
        final: bool,
    ) -> Written:
        """Writes one group (one chapter and type). `used`: evidence the paper already used; `feedback`: what
        was wrong with each slot's last question; `final`: the last try, after which failures stay flagged."""
        run = await _run(self._store, job.org_id, job.run_id)
        spec, languages = run.spec, _languages(run.spec)
        node_id, qtype = slots[0]["taxonomyNodeId"], slots[0]["qtype"]
        node = (await self._store.nodes(job.org_id, [node_id]))[node_id]
        hits = await _evidence(self._search, job.org_id, node, languages, used)
        if not hits:
            return Written(
                [{**slot, "state": "insufficient_evidence", "flags": [NO_EVIDENCE]} for slot in slots]
            )
        caller = _caller(job, run)
        glossary = await self._store.glossary(job.org_id, [node_id])
        ask = [
            f"Chapter: {node.name(['hi', 'en'])}",
            f"Languages: {_language_names(languages)}",
            "",
            "Write one question for each slot:",
            _slot_lines(slots),
        ]
        problems = [
            f'- slot "{slot["slotId"]}": ' + "; ".join(feedback[slot["slotId"]])
            for slot in slots
            if feedback.get(slot["slotId"])
        ]
        if problems:
            ask += ["", "Your last questions for these slots were rejected. Avoid these problems:", *problems]
        request = LlmRequest(
            caller=caller,
            task="generate",
            variables={
                "exam": spec.get("examCode") or "the center's own test",
                "languages": _language_names(languages),
                "glossary": "\n".join(f"{en} = {hi}" for en, hi in glossary) or "(none)",
            },
            turns=(Turn("user", "\n".join(ask)),),
            prompt_cache="1h",  # the rules and style are the same for every call for this exam
            context=(Segment(evidence(hits), cache="5m"),),
            model_id=job.model_id,
        )
        try:
            reply = await self._models.complete_structured(request, WrittenBatch)
        except InvalidOutput as problem:
            reason = f"the model's reply couldn't be read ({problem})"
            return Written([{**slot, "state": "flagged", "flags": [reason]} for slot in slots])
        by_slot = {q.slot: q for q in reply.value.questions}
        drafts: dict[str, tuple[dict[str, Any], dict[str, Any], list[int], list[str]]] = {}
        for slot in slots:
            written = by_slot.get(slot["slotId"])
            if written is None:
                continue
            content, answer = _content(written, qtype, languages), _answer(written, qtype)
            numbers = _numbers(written.cites, len(hits))
            drafts[slot["slotId"]] = (
                content,
                answer,
                numbers,
                check_question(qtype, content, answer, languages, len(numbers)),
            )
        grounding = await self._ground(caller, hits, {k: v for k, v in drafts.items() if not v[3]})
        out: list[Slot] = []
        chunk_ids: list[str] = []
        for slot in slots:
            if slot["slotId"] not in drafts:
                out.append({**slot, "state": "flagged", "flags": ["the model didn't write this question"]})
                continue
            content, answer, numbers, problems_found = drafts[slot["slotId"]]
            verdict = grounding.get(slot["slotId"])
            if not problems_found and verdict is not None and not verdict.supported:
                problems_found = [f"not supported by the material: {verdict.problem or 'no reason given'}"]
            passed = not problems_found
            if not passed and (not final or not (content["hi"] or content["en"])):
                out.append({**slot, "state": "flagged", "flags": problems_found})
                continue
            # Each cited passage with the neighbours it was shown with, for the answer check to read.
            cited = [
                str(p.chunk_id)
                for n in numbers
                for p in (*hits[n - 1].before, hits[n - 1].passage, *hits[n - 1].after)
            ]
            chunk_ids += cited
            question_id = await self._store.save_question(
                job.org_id,
                NewQuestion(
                    qtype=qtype,
                    status="draft" if passed else "flagged",
                    content=content,
                    answer=answer,
                    language=languages[0],
                    marks=float(slot["marks"]),
                    negative_marks=float(spec["sections"][slot["sectionIndex"]].get("negativeMarks", 0)),
                    difficulty=int(slot["difficulty"]),
                    node_id=node_id,
                    exam_id=run.exam_id,
                    provenance={
                        "chunkIds": cited,
                        "runId": str(run.id),
                        "documentId": str(run.document_id),
                        "slotId": slot["slotId"],
                        "model": reply.reply.model_id,
                        "prompt": reply.reply.prompt_version,
                    },
                    verification={
                        "fast": problems_found if not passed else [],
                        "grounding": verdict.model_dump() if verdict else None,
                    },
                    created_by=job.requested_by,
                ),
            )
            state = "generated" if passed else "flagged"
            out.append({**slot, "state": state, "questionId": str(question_id), "flags": problems_found})
        return Written(out, chunk_ids, reply.reply.model_id)

    async def _ground(
        self,
        caller: Caller,
        hits: Sequence[Hit],
        drafts: Mapping[str, tuple[dict[str, Any], dict[str, Any], list[int], list[str]]],
    ) -> dict[str, Verdict]:
        """A cheap model's verdict on whether the material supports each question and its answer."""
        if not drafts:
            return {}
        items = [
            f'<item id="{slot_id}">\n{_printed(content, answer)}\nCites passages: '
            f"{', '.join(map(str, numbers))}\n</item>"
            for slot_id, (content, answer, numbers, _) in drafts.items()
        ]
        reply = await self._models.complete_structured(
            LlmRequest(
                caller=caller,
                task="verify_grounding",
                variables={"kind": "questions", "items": "\n\n".join(items)},
                context=(Segment(evidence(hits), cache="5m"),),
            ),
            Grounding,
        )
        return {v.item: v for v in reply.value.verdicts}


class CheckAnswers:
    def __init__(self, store: GenerationStore, models: ChatModels) -> None:
        self._store = store
        self._models = models

    async def execute(self, job: Job, slots: Sequence[Slot], written_by: str | None) -> list[Slot]:
        """Each generated question solved by the other provider without its key, each language on its own,
        with the passages it was written from (the center's material decides): verified when every version
        reaches the key, flagged otherwise."""
        run = await _run(self._store, job.org_id, job.run_id)
        caller = _caller(job, run)
        ids = [UUID(slot["questionId"]) for slot in slots]
        questions = await self._store.questions(job.org_id, ids)
        gate = asyncio.Semaphore(SOLVING)

        async def check(slot: Slot) -> Slot:
            async with gate:
                question = questions[slot["questionId"]]
                problems = await self._solve(caller, question, written_by)
            status = "flagged" if problems else "verified"
            await self._store.checked(
                job.org_id, UUID(slot["questionId"]), status, {"solve": problems or "agreed"}
            )
            return {**slot, "state": status, "flags": problems}

        return list(await asyncio.gather(*(check(slot) for slot in slots)))

    async def _solve(self, caller: Caller, question: Mapping[str, Any], written_by: str | None) -> list[str]:
        answer: dict[str, Any] = question["answer"]
        if answer.get("kind") not in ("options", "numeric"):
            return []  # written answers: grounding is their check
        texts = await self._store.passages(caller.org_id, question["provenance"].get("chunkIds", []))
        material = "\n\n".join(f'<passage n="{n}">\n{text}\n</passage>' for n, text in enumerate(texts, 1))
        problems: list[str] = []
        found: dict[str, str] = {}
        for lang in ("hi", "en"):
            version = question["content"].get(lang)
            if not version:
                continue
            lines = [
                f"Type: {type_name(question['qtype'], 'en')} ({question['qtype']})",
                f"Question: {version['stem']}",
                *(f"{o['key']}) {o['text']}" for o in version.get("options", [])),
            ]
            solved = await self._models.complete_structured(
                LlmRequest(
                    caller=caller,
                    task="verify_solve",
                    variables={"question": "\n".join(lines)},
                    context=(Segment(f"The center's material:\n\n{material}"),) if texts else (),
                    written_by=written_by,
                ),
                Solution,
            )
            result = solved.value.model_dump()
            found[lang] = shown({**answer, "keys": result["keys"], "value": result["value"]})
            if not answers_agree(answer, result):
                which = "Hindi" if lang == "hi" else "English"
                problems.append(
                    f"a second model answered the {which} version {found[lang]}; the key says {shown(answer)}"
                )
        if len(set(found.values())) > 1:
            problems.append("the Hindi and English versions lead to different answers")
        return problems


class AssemblePaper:
    def __init__(self, store: GenerationStore) -> None:
        self._store = store

    async def execute(self, org_id: UUID, run_id: UUID, slots: Sequence[Slot]) -> dict[str, Any]:
        run = await _run(self._store, org_id, run_id)
        ids = [UUID(slot["questionId"]) for slot in slots if slot.get("questionId")]
        questions = await self._store.questions(org_id, ids)
        document = assemble(run.spec, slots, questions, seed=str(run.id))
        return PaperDocument.model_validate(document).model_dump(
            mode="json", by_alias=True, exclude_unset=True
        )


# --- Notes ---------------------------------------------------------------------------------------------


class PlanNotes:
    def __init__(self, store: GenerationStore) -> None:
        self._store = store

    async def execute(self, org_id: UUID, run_id: UUID) -> list[dict[str, Any]]:
        """One section per chapter, or per topic of each chapter for standard and detailed notes."""
        run = await _run(self._store, org_id, run_id)
        spec = run.spec
        chosen = await self._store.nodes(org_id, spec["taxonomyNodeIds"])
        nodes: list[Node] = []
        for node_id in spec["taxonomyNodeIds"]:
            topics = await self._store.children(org_id, node_id) if spec["depth"] != "brief" else []
            nodes += topics or ([chosen[node_id]] if node_id in chosen else [])
        return [
            {
                "nodeId": node.id,
                "title": {"en": node.name_en, **({"hi": node.name_hi} if node.name_hi else {})},
                "body": {},
                "citations": [],
                "state": "pending",
                "flags": [],
            }
            for node in nodes[:NOTES_SECTIONS]
        ]


@dataclass(frozen=True)
class WrittenSection:
    section: dict[str, Any]
    chunk_ids: list[str] = field(default_factory=list[str])


class WriteNotesSection:
    def __init__(self, store: GenerationStore, models: ChatModels, search: Searcher) -> None:
        self._store = store
        self._models = models
        self._search = search

    async def execute(
        self,
        job: Job,
        section: Mapping[str, Any],
        *,
        used: Sequence[str],
        feedback: Sequence[str],
        final: bool,
    ) -> WrittenSection:
        run = await _run(self._store, job.org_id, job.run_id)
        spec, languages = run.spec, _languages(run.spec)
        node = (await self._store.nodes(job.org_id, [section["nodeId"]]))[section["nodeId"]]
        hits = await _evidence(self._search, job.org_id, node, languages, used)
        if not hits:
            return WrittenSection({**section, "state": "insufficient_evidence", "flags": [NO_EVIDENCE]})
        caller = _caller(job, run)
        glossary = await self._store.glossary(job.org_id, [node.id])
        ask = [
            f"Topic: {node.name(['hi', 'en'])}",
            f"Kind: {'a revision sheet' if spec['kind'] == 'revision_sheet' else 'teaching notes'}, "
            f"{spec['depth']} depth",
            f"Languages: {_language_names(languages)}",
            f"Worked examples: {'yes' if spec.get('includeExamples') else 'no'}",
            f"Practice questions at the end: {'yes' if spec.get('includePractice') else 'no'}",
        ]
        if feedback:
            ask += [
                "",
                "Your last version was rejected. Avoid these problems:",
                *(f"- {p}" for p in feedback),
            ]
        try:
            reply = await self._models.complete_structured(
                LlmRequest(
                    caller=caller,
                    task="notes_write",
                    variables={
                        "exam": spec.get("examCode") or "the center's own course",
                        "glossary": "\n".join(f"{en} = {hi}" for en, hi in glossary) or "(none)",
                    },
                    turns=(Turn("user", "\n".join(ask)),),
                    prompt_cache="1h",
                    context=(Segment(evidence(hits), cache="5m"),),
                    model_id=job.model_id,
                ),
                NotesWritten,
            )
        except InvalidOutput as problem:
            return WrittenSection(
                {**section, "state": "flagged", "flags": [f"the reply couldn't be read ({problem})"]}
            )
        written = reply.value
        bodies = {
            lang: getattr(written, lang) for lang in languages if (getattr(written, lang) or "").strip()
        }
        numbers = _numbers(written.cites, len(hits))
        problems = [
            f"no text in {'Hindi' if lang == 'hi' else 'English'}" for lang in languages if lang not in bodies
        ]
        if not numbers:
            problems.append("cites none of the evidence")
        if not problems:
            text = bodies.get("en") or bodies.get("hi") or ""
            verdict = await self._models.complete_structured(
                LlmRequest(
                    caller=caller,
                    task="verify_grounding",
                    variables={"kind": "notes", "items": f'<item id="{node.id}">\n{text}\n</item>'},
                    context=(Segment(evidence(hits), cache="5m"),),
                ),
                Grounding,
            )
            refused = [v for v in verdict.value.verdicts if not v.supported]
            if refused:
                problems.append(f"not supported by the material: {refused[0].problem or 'no reason given'}")
        if problems and (not final or not bodies):
            return WrittenSection({**section, "state": "flagged", "flags": problems})
        names = await self._store.file_names(job.org_id, [hits[n - 1].passage.source_id for n in numbers])
        citations: list[dict[str, Any]] = [
            {
                "chunkId": str(p.chunk_id),
                "sourceId": str(p.source_id),
                "filename": PurePosixPath(names.get(p.source_id, p.title or "?")).name,
                "pageStart": p.page_start,
                "pageEnd": p.page_end,
                "pageLabel": p.page_label,
                "quote": " ".join(p.text.split())[:240],
            }
            for p in (hits[n - 1].passage for n in numbers)
        ]
        return WrittenSection(
            {
                **section,
                "body": {lang: renumber(body, numbers) for lang, body in bodies.items()},
                "citations": citations,
                "state": "flagged" if problems else "verified",
                "flags": problems,
            },
            [str(c["chunkId"]) for c in citations],
        )


def assemble_notes(spec: Mapping[str, Any], sections: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    document = {"spec": dict(spec), "sections": [dict(section) for section in sections]}
    return NotesDocument.model_validate(document).model_dump(mode="json", by_alias=True, exclude_unset=True)
