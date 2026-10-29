"""The chat agent (plan v3 §6, step 23; ADR 0015): answers a turn the API has recorded.

The API records the teacher's message, then asks for an answer by ids only. This reads the chat (never writes
it: the API is the single writer), streams the answer as events, and ends with `done`, which carries the whole
answer for the API to store. A new chat is named alongside its first answer.

What the teacher sent decides the work:

- **Typed text** gets one cheap structured call (`spec`): the intent, what to make, the exam, and the chapter
  and topic names as typed. Names are matched to the syllabus in code (`domain/mentions.py`).
  - *create*: the draft spec takes what was asked, then the rules in `domain/specs.py` ask for what is
    missing (at most two cards) or show the review card with what the bank has and a cost estimate.
  - *ask*: search the center's material (step 20) and answer from it with numbered citations; with nothing
    found, say so instead of guessing.
  - *edit*: editing documents by chat comes with the document editor (step 28).
  - *chat*: anything else, answered briefly.
- **An answered card** merges into the draft with no model call.
- **A button**: Confirm (generation starts in step 26), Cancel (the draft is cleared), Undo.
"""

import asyncio
import contextlib
import json
import logging
import re
from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import PurePosixPath
from typing import Any, Literal, Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict, ValidationError

from vidyam_ai.application.llm_gateway import (
    BudgetExceeded,
    Caller,
    CostEstimate,
    LlmError,
    LlmReply,
    LlmRequest,
    ModelNotAllowed,
    ModelUnavailable,
    ProviderError,
    ProviderNotConfigured,
    StructuredReply,
)
from vidyam_ai.application.retrieval import Hit, RetrievalRequest, Retrieved
from vidyam_ai.domain.chat import (
    StoredMessage,
    conversation,
    first_question,
    language_of,
    message_text,
    reply,
)
from vidyam_ai.domain.llm import Segment, Usage
from vidyam_ai.domain.mentions import NodeName, resolve
from vidyam_ai.domain.specs import (
    PAPERS,
    Draft,
    Pattern,
    Wish,
    apply_values,
    availability,
    cards,
    choose_pattern,
    complete,
    languages_for,
    merge,
    minutes,
    missing,
    title_for,
    with_defaults,
    work,
)
from vidyam_ai.generated.contracts import PaperSection

log = logging.getLogger(__name__)

Event = dict[str, Any]  # a ChatEngineEvent, as sent
CONTEXT_TURNS = 8  # what the understanding call sees of the conversation
EVIDENCE = 6  # passages a doubt is answered from


@dataclass(frozen=True)
class Transcript:
    title: str
    model_override: str | None
    draft_spec: Draft | None
    document_id: UUID | None
    messages: Sequence[StoredMessage]  # oldest first, ending with the teacher's message being answered


@dataclass(frozen=True)
class Teacher:
    ui_locale: str | None
    content_language: str | None  # hi, en, bilingual
    default_exam: str | None  # exam code
    subjects: tuple[UUID, ...] = ()


@dataclass(frozen=True)
class Exam:
    code: str
    name_en: str
    name_hi: str | None


class ChatContext(Protocol):
    """Port: what the agent reads about the chat, the teacher and the center (read-only)."""

    async def transcript(self, org_id: UUID, session_id: UUID, up_to_message: UUID) -> Transcript | None: ...
    async def teacher(self, org_id: UUID, user_id: UUID) -> Teacher: ...
    async def exams(self, org_id: UUID) -> list[Exam]: ...
    async def patterns(self, org_id: UUID, exam_code: str) -> list[Pattern]:
        """The exam's active paper patterns."""
        ...

    async def pattern_by_id(self, org_id: UUID, pattern_id: UUID) -> Pattern | None: ...
    async def nodes(self, org_id: UUID, *, exam_code: str | None, subjects: Sequence[UUID]) -> list[NodeName]:
        """Syllabus nodes a mention may mean: the exam's syllabus, else the teacher's subjects, else all."""
        ...

    async def node_names(self, org_id: UUID, ids: Sequence[str], language: str) -> dict[str, str]: ...
    async def bank_counts(
        self, org_id: UUID, node_ids: Sequence[str], qtypes: Sequence[str]
    ) -> dict[str, int]:
        """Approved and verified bank questions of these types under each node."""
        ...

    async def file_names(self, org_id: UUID, source_ids: Sequence[UUID]) -> dict[UUID, str]: ...


class ChatModels(Protocol):
    """Port: the LLM gateway."""

    def stream(self, request: LlmRequest) -> AsyncIterator[str | LlmReply]: ...
    async def complete(self, request: LlmRequest) -> LlmReply: ...
    async def complete_structured[M: BaseModel](
        self, request: LlmRequest, output: type[M]
    ) -> StructuredReply[M]: ...
    async def quote(
        self, org_id: UUID, task: str, usages: Sequence[Usage], *, model_id: str | None = None
    ) -> CostEstimate: ...


class Searcher(Protocol):
    """Port: retrieval (step 20)."""

    async def execute(self, request: RetrievalRequest) -> Retrieved: ...


QuestionTypeName = Literal[
    "mcq_single", "mcq_multi", "numerical", "integer", "assertion_reason",
    "match_columns", "statement", "passage", "short_answer", "long_answer",
]  # fmt: skip


class Understanding(BaseModel):
    """What one typed message asks for (the `spec` task's structured output)."""

    model_config = ConfigDict(extra="forbid")

    intent: Literal["create", "ask", "edit", "chat"]
    kind: Literal["question_paper", "worksheet", "notes", "revision_sheet"] | None
    exam_code: str | None
    topics: list[str]
    question_count: int | None
    question_types: list[QuestionTypeName]
    difficulty: Literal["easy", "medium", "hard"] | None
    languages: list[Literal["hi", "en"]]
    duration_minutes: int | None
    sourcing: Literal["bank_first", "fresh_only", "bank_only"] | None
    title: str | None
    question: str | None  # for "ask": the doubt as a standalone search query


@dataclass(frozen=True)
class TurnRef:
    org_id: UUID
    user_id: UUID
    session_id: UUID
    turn_id: UUID
    user_message_id: UUID
    model_id: str | None


@dataclass
class _Answer:
    """What a turn says, gathered for `done` as it streams."""

    text: list[str] = field(default_factory=list[str])
    blocks: list[dict[str, Any]] = field(default_factory=list[dict[str, Any]])
    status: Literal["idle", "awaiting_input"] = "idle"
    model_id: str | None = None

    def say(self, text: str) -> Event:
        self.text.append(text)
        return {"event": "text_delta", "text": text}

    def add(self, block: dict[str, Any]) -> Event:
        self.blocks.append(block)
        return {"event": "block", "block": block}

    def all_blocks(self) -> list[dict[str, Any]]:
        text = "".join(self.text)
        return [*([{"type": "text", "text": text}] if text else []), *self.blocks]


def error(code: str, message: str) -> Event:
    return {"event": "error", "code": code, "message": message}


def _failure(problem: Exception) -> Event:
    match problem:
        case BudgetExceeded():
            return error("budget_exceeded", str(problem))
        case ModelNotAllowed() | ModelUnavailable():
            return error("model_unavailable", str(problem))
        case ProviderNotConfigured():
            return error("not_configured", str(problem))
        case ProviderError():
            return error(
                "provider_error", f"The AI provider didn't answer. Try again in a moment. ({problem})"
            )
        case _:
            return error("model_error", str(problem))


_CITATION = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")


def cited(text: str, count: int) -> list[int]:
    """Passage numbers the answer cites ([2], [1, 3]), in the order first cited."""
    found: dict[int, None] = {}
    for match in _CITATION.finditer(text):
        for number in match.group(1).split(","):
            n = int(number)
            if 1 <= n <= count:
                found.setdefault(n)
    return list(found)


def renumber(text: str, order: Sequence[int]) -> str:
    """Citation markers renumbered 1, 2, 3… in the order first cited, to match the list of sources."""
    new = {old: n for n, old in enumerate(order, 1)}

    def swap(match: re.Match[str]) -> str:
        numbers = [new.get(int(number), int(number)) for number in match.group(1).split(",")]
        return "[" + ", ".join(str(number) for number in numbers) + "]"

    return _CITATION.sub(swap, text)


def evidence(hits: Sequence[Hit]) -> str:
    """The passages a doubt is answered from, numbered for citing."""
    parts: list[str] = []
    for n, hit in enumerate(hits, 1):
        p = hit.passage
        page = p.page_label or (str(p.page_start) if p.page_start else "")
        where = f' source="{p.title or "untitled"}"' + (f' page="{page}"' if page else "")
        heading = f"{p.heading_path}\n" if p.heading_path else ""
        parts.append(f'<passage n="{n}"{where}>\n{heading}{hit.context}\n</passage>')
    return "Passages from the center's material:\n\n" + "\n\n".join(parts)


class ChatAgent:
    def __init__(self, context: ChatContext, models: ChatModels, search: Searcher | None) -> None:
        self._context = context
        self._models = models
        self._search = search

    async def execute(self, turn: TurnRef) -> AsyncIterator[Event]:
        transcript = await self._context.transcript(turn.org_id, turn.session_id, turn.user_message_id)
        if transcript is None or not transcript.messages or transcript.messages[-1].role != "user":
            yield error("not_found", "That message isn't in this chat.")
            return
        caller = Caller(turn.org_id, turn.user_id, chat_session_id=turn.session_id, turn_id=turn.turn_id)
        teacher = await self._context.teacher(turn.org_id, turn.user_id)
        question = first_question(transcript.messages)
        language = teacher.ui_locale or ("hi" if language_of(question) == "Hindi" else "en")
        naming = None if transcript.title else asyncio.create_task(self._title(caller, question))
        answer = _Answer()
        model_id = turn.model_id or transcript.model_override
        last = transcript.messages[-1].blocks
        try:
            try:
                kinds = {block.get("type") for block in last}
                if "action" in kinds:
                    action = next(b for b in last if b.get("type") == "action")
                    events = self._action(transcript, action, language, answer)
                elif "card_response" in kinds:
                    values = next(b for b in last if b.get("type") == "card_response")["values"]
                    events = self._card(turn, transcript, teacher, values, language, answer)
                else:
                    events = self._text(caller, turn, transcript, teacher, language, model_id, answer)
                async for event in events:
                    yield event
            except (LlmError, ProviderError) as problem:
                yield _failure(problem)
                return
            title = await naming if naming else None
            yield {
                "event": "done",
                "blocks": answer.all_blocks(),
                "modelId": answer.model_id,
                "title": title,
                "sessionStatus": answer.status,
            }
        finally:
            if naming and not naming.done():
                naming.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await naming

    # --- Typed text -----------------------------------------------------------------------------------------

    async def _text(
        self,
        caller: Caller,
        turn: TurnRef,
        transcript: Transcript,
        teacher: Teacher,
        language: str,
        model_id: str | None,
        answer: _Answer,
    ) -> AsyncIterator[Event]:
        exams = await self._context.exams(turn.org_id)
        understood = await self._understand(caller, transcript, exams)
        match understood.intent:
            case "create":
                events = self._create(turn, transcript, teacher, understood, exams, language, answer)
            case "ask":
                query = understood.question or message_text(transcript.messages[-1].blocks)
                events = self._ask(caller, turn, transcript, teacher, query, language, model_id, answer)
            case "edit" if transcript.document_id:
                yield answer.say(reply("edit_later", language))
                return
            case _:
                events = self._chat(caller, transcript, model_id, answer)
        async for event in events:
            yield event

    async def _understand(
        self, caller: Caller, transcript: Transcript, exams: Sequence[Exam]
    ) -> Understanding:
        exam_list = "\n".join(f"{exam.code} | {exam.name_en} | {exam.name_hi or ''}" for exam in exams)
        request = LlmRequest(
            caller=caller,
            task="spec",
            variables={
                "exams": exam_list or "(none)",
                "draft": json.dumps(transcript.draft_spec or {}, ensure_ascii=False),
            },
            turns=conversation(transcript.messages)[-CONTEXT_TURNS:],
        )
        return (await self._models.complete_structured(request, Understanding)).value

    # --- Making something: the draft spec, cards and the review card ----------------------------------------

    async def _create(
        self,
        turn: TurnRef,
        transcript: Transcript,
        teacher: Teacher,
        understood: Understanding,
        exams: Sequence[Exam],
        language: str,
        answer: _Answer,
    ) -> AsyncIterator[Event]:
        draft: Draft = dict(transcript.draft_spec or {})
        codes = {exam.code for exam in exams}
        exam_code = understood.exam_code if understood.exam_code in codes else None
        if not exam_code and not draft.get("examCode") and teacher.default_exam in codes:
            exam_code = teacher.default_exam
        exam = exam_code or draft.get("examCode")
        nodes = await self._context.nodes(turn.org_id, exam_code=exam, subjects=teacher.subjects)
        resolutions = [resolve(topic, nodes) for topic in understood.topics]
        chosen = [r.node for r in resolutions if r.node] or draft.get("taxonomyNodeIds", [])
        patterns = await self._context.patterns(turn.org_id, exam) if exam else []
        pattern = choose_pattern(
            patterns,
            kind=understood.kind or draft.get("kind"),
            count=understood.question_count,
            nodes=len(chosen),
        )
        if not exam_code and not understood.question_count and draft.get("blueprintId"):
            # Same exam, no new size: the teacher keeps the pattern they have.
            pattern = next((p for p in patterns if str(p.id) == draft["blueprintId"]), pattern)
        wish = Wish(
            kind=understood.kind,
            exam_code=exam_code,
            node_ids=tuple(r.node for r in resolutions if r.node),
            question_count=understood.question_count,
            question_types=tuple(understood.question_types),
            difficulty=understood.difficulty,
            languages=tuple(understood.languages),
            duration_minutes=understood.duration_minutes,
            sourcing=understood.sourcing,
            title=understood.title,
        )
        draft = with_defaults(merge(draft, wish, pattern), languages_for(teacher.content_language), pattern)
        suggestions = [node for r in resolutions for node in r.candidates]
        async for event in self._next(turn, draft, suggestions, exams, language, answer):
            yield event

    async def _card(
        self,
        turn: TurnRef,
        transcript: Transcript,
        teacher: Teacher,
        values: Mapping[str, Any],
        language: str,
        answer: _Answer,
    ) -> AsyncIterator[Event]:
        """An answered card merges into the draft; no model is asked."""
        draft: Draft = dict(transcript.draft_spec or {})
        exams = await self._context.exams(turn.org_id)
        plain = dict(values)
        exam_code = plain.pop("exam", draft.get("examCode"))
        if exam_code not in {exam.code for exam in exams}:
            exam_code = None
        nodes: Sequence[Any] = plain.get("taxonomy_nodes") or draft.get("taxonomyNodeIds") or []
        pattern = choose_pattern(
            await self._context.patterns(turn.org_id, exam_code) if exam_code else [],
            kind=plain.get("kind", draft.get("kind")),
            count=None,
            nodes=len(nodes),
        )
        blueprint = plain.pop("blueprint", None)
        if blueprint:
            with contextlib.suppress(ValueError):
                pattern = await self._context.pattern_by_id(turn.org_id, UUID(str(blueprint))) or pattern
        if "sections" in plain:
            try:
                plain["sections"] = [
                    PaperSection.model_validate(section).model_dump(by_alias=True, mode="json")
                    for section in plain["sections"]
                ]
            except ValidationError:
                plain.pop("sections")
        draft = merge(draft, Wish(exam_code=exam_code), pattern)
        if blueprint and pattern and "sections" not in plain:
            draft["blueprintId"], draft["sections"] = str(pattern.id), [dict(s) for s in pattern.sections]
            draft["durationMinutes"] = pattern.duration_minutes
        draft = with_defaults(apply_values(draft, plain), languages_for(teacher.content_language), pattern)
        async for event in self._next(turn, draft, [], exams, language, answer):
            yield event

    async def _next(
        self,
        turn: TurnRef,
        draft: Draft,
        suggestions: Sequence[UUID],
        exams: Sequence[Exam],
        language: str,
        answer: _Answer,
    ) -> AsyncIterator[Event]:
        """The cards for what is still missing, or the review card when nothing is."""
        answer.status = "awaiting_input"
        scope, shape = missing(draft)
        if scope or shape:
            yield {"event": "draft_spec", "draftSpec": draft}
            yield answer.say(reply("need_details", language))
            for card in cards(
                draft, str(turn.turn_id), scope=scope, shape=shape, node_suggestions=suggestions
            ):
                yield answer.add(card)
            return
        nodes: list[str] = draft["taxonomyNodeIds"]
        names = await self._context.node_names(turn.org_id, nodes, language)
        exam = next((e for e in exams if e.code == draft.get("examCode")), None)
        exam_name = (exam.name_hi if language == "hi" and exam.name_hi else exam.name_en) if exam else None
        title = title_for(draft["kind"], exam_name, [names.get(node, node) for node in nodes], language)
        spec = complete(draft, title)
        qtypes = sorted({section["qtype"] for section in spec.get("sections", [])})
        bank = await self._context.bank_counts(turn.org_id, nodes, qtypes) if qtypes else {}
        per_node = availability(spec, bank, names)
        to_generate = sum(item["toGenerate"] for item in per_node) if draft["kind"] in PAPERS else 0
        low, high = await self._estimate(turn, spec, to_generate)
        yield {
            "event": "draft_spec",
            "draftSpec": draft,
        }  # the title stays automatic until the teacher sets one
        yield answer.say(reply("review", language))
        yield answer.add(
            {
                "type": "spec_review",
                "spec": spec,
                "availability": per_node,
                "estimate": {"usdLow": low, "usdHigh": high, "minutes": minutes(spec, to_generate)},
                "confirmedAt": None,
            }
        )

    async def _estimate(
        self, turn: TurnRef, spec: Mapping[str, Any], to_generate: int
    ) -> tuple[float, float]:
        low, high = Decimal(0), Decimal(0)
        for task, (fewest, most) in work(spec, to_generate).items():
            # The teacher's chosen model makes the questions; checks run on their own routes.
            chosen = turn.model_id if task in ("generate", "notes_write") else None
            try:
                low += (await self._models.quote(turn.org_id, task, fewest, model_id=chosen)).cost_usd
                high += (await self._models.quote(turn.org_id, task, most, model_id=chosen)).cost_usd
            except LlmError as problem:  # a route not set up yet: shown without it
                log.warning("estimate for %s: %s", task, problem)
        return round(float(low), 2), round(float(high), 2)

    # --- Buttons --------------------------------------------------------------------------------------------

    async def _action(
        self, transcript: Transcript, block: Mapping[str, Any], language: str, answer: _Answer
    ) -> AsyncIterator[Event]:
        draft = transcript.draft_spec or {}
        match block.get("action"):
            case "confirm_spec":
                ready = bool(draft) and not any(missing(draft))
                yield answer.say(reply("generation_off" if ready else "nothing_to_confirm", language))
                answer.status = "awaiting_input" if ready else "idle"
            case "cancel":
                yield {"event": "draft_spec", "draftSpec": {}}
                yield answer.say(reply("cancelled", language))
            case _:
                yield answer.say(reply("nothing_to_undo", language))

    # --- Doubts and conversation ----------------------------------------------------------------------------

    async def _ask(
        self,
        caller: Caller,
        turn: TurnRef,
        transcript: Transcript,
        teacher: Teacher,
        query: str,
        language: str,
        model_id: str | None,
        answer: _Answer,
    ) -> AsyncIterator[Event]:
        hits: list[Hit] = []
        if self._search:
            preferred = {"hi": "hi", "en": "en"}.get(teacher.content_language or "")
            found = await self._search.execute(
                RetrievalRequest(turn.org_id, query, limit=EVIDENCE, language=preferred)
            )
            hits = found.hits
        if not hits:
            yield answer.say(reply("not_found", language))
            return
        request = LlmRequest(
            caller=caller,
            task="chat_qa",
            turns=conversation(transcript.messages),
            context=(Segment(evidence(hits), cache="5m"),),
            model_id=model_id,
        )
        async for event in self._stream(request, answer):
            yield event
        numbers = cited("".join(answer.text), len(hits))
        if numbers:
            # The stored answer cites its sources 1, 2, 3… in the order of the list below it.
            answer.text = [renumber("".join(answer.text), numbers)]
            names = await self._context.file_names(
                turn.org_id, [hits[n - 1].passage.source_id for n in numbers]
            )
            items = []
            for n in numbers:
                p = hits[n - 1].passage
                items.append(
                    {
                        "chunkId": str(p.chunk_id),
                        "sourceId": str(p.source_id),
                        "filename": PurePosixPath(names.get(p.source_id, p.title or "?")).name,
                        "pageStart": p.page_start,
                        "pageEnd": p.page_end,
                        "pageLabel": p.page_label,
                        "quote": " ".join(p.text.split())[:240],
                    }
                )
            yield answer.add({"type": "citations", "items": items})

    async def _chat(
        self, caller: Caller, transcript: Transcript, model_id: str | None, answer: _Answer
    ) -> AsyncIterator[Event]:
        request = LlmRequest(
            caller=caller, task="chat_qa", turns=conversation(transcript.messages), model_id=model_id
        )
        async for event in self._stream(request, answer):
            yield event

    async def _stream(self, request: LlmRequest, answer: _Answer) -> AsyncIterator[Event]:
        async for item in self._models.stream(request):
            if isinstance(item, str):
                yield answer.say(item)
            else:
                answer.model_id = item.model_id

    async def _title(self, caller: Caller, question: str) -> str | None:
        """A short name for a new chat; without one the chat keeps its placeholder."""
        if not question:
            return None
        try:
            named = await self._models.complete(
                LlmRequest(
                    caller=caller,
                    task="chat_title",
                    variables={"first_message": question, "language": language_of(question)},
                )
            )
        except (LlmError, ProviderError) as problem:
            log.warning("chat title: %s", problem)
            return None
        title = named.text.strip().strip('"“”').strip()
        return title[:120] or None
