"""The chat agent (plan v3 §6, step 23; ADR 0015): what a teacher sends decides the work, from understanding a
request to the review card, answering a doubt from the center's material with citations, card answers and
buttons, and failures as errors the teacher can read. Also the internal NDJSON endpoint."""

import json
from collections.abc import AsyncIterator, Sequence
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from pydantic import BaseModel
from vidyam_ai.application.chat import (
    ChatAgent,
    Exam,
    Teacher,
    Transcript,
    TurnRef,
    Understanding,
    cited,
    renumber,
)
from vidyam_ai.application.llm_gateway import (
    BudgetExceeded,
    CostEstimate,
    LlmReply,
    LlmRequest,
    ProviderError,
    StructuredReply,
)
from vidyam_ai.application.retrieval import Hit, RetrievalRequest, Retrieved
from vidyam_ai.domain.chat import StoredMessage, conversation, first_question, language_of, message_text
from vidyam_ai.domain.llm import Budget, Turn, Usage
from vidyam_ai.domain.mentions import NodeName
from vidyam_ai.domain.retrieval import Passage
from vidyam_ai.domain.specs import DIFFICULTY, Pattern
from vidyam_ai.interface.http.app import create_app

from tests.unit.test_http import TOKEN, settings

MOTION, LINE, NOTES = uuid4(), uuid4(), uuid4()
NODES = [
    NodeName(MOTION, "laws_of_motion", "chapter", ("Laws of Motion", "गति के नियम", "gati ke niyam")),
    NodeName(LINE, "motion_in_a_straight_line", "chapter", ("Motion in a Straight Line", "सरल रेखा में गति")),
]
SECTION = {
    "name": {"en": "MCQ"}, "qtype": "mcq_single", "count": 100, "marksEach": 2, "negativeMarks": 0,
    "attemptAny": None, "difficultyMix": DIFFICULTY["medium"], "scope": [],
}  # fmt: skip
PATTERN = Pattern(uuid4(), (SECTION,), 120, DIFFICULTY["medium"], "Full paper")


def test_a_message_reads_as_its_words_answers_and_sources() -> None:
    blocks = [
        {"type": "text", "text": "त्वरण क्या है?"},
        {"type": "clarification", "cardId": "c1", "purpose": "scope", "fields": [{"key": "exam"}]},
        {"type": "card_response", "cardId": "c1", "values": {}, "summary": "Exam: REET Level 2"},
        {"type": "action", "action": "cancel", "targetId": None, "summary": "Cancel"},
        {
            "type": "citations",
            "items": [{"filename": "motion.pdf", "pageLabel": "42"}, {"filename": "x.docx"}],
        },
        {"type": "progress", "runId": str(uuid4()), "stage": "generate", "done": 1, "total": 2},
    ]
    assert message_text(blocks) == (
        "त्वरण क्या है?\n\nExam: REET Level 2\n\nCancel\n\nSources: motion.pdf, p. 42; x.docx"
    )
    messages = [
        StoredMessage("user", [{"type": "text", "text": "hello"}]),
        StoredMessage("assistant", [{"type": "error", "code": "x", "message": "failed"}]),
        StoredMessage("user", [{"type": "text", "text": "Ohm's law?"}]),
    ]
    assert conversation(messages) == [Turn("user", "hello\n\nOhm's law?")]
    assert first_question(messages) == "hello"
    assert (language_of("न्यूटन का तीसरा नियम"), language_of("newton ka teesra niyam")) == ("Hindi", "English")
    assert cited("Force is ma [2]. Also [1, 3] and [9].", 3) == [2, 1, 3]
    assert renumber("Force is ma [2]. Also [1, 3].", [2, 1, 3]) == "Force is ma [1]. Also [2, 3]."


def understanding(**fields: Any) -> Understanding:
    base: dict[str, Any] = {
        "intent": "chat", "kind": None, "exam_code": None, "topics": [], "question_count": None,
        "question_types": [], "difficulty": None, "languages": [], "duration_minutes": None, "sourcing": None,
        "title": None, "question": None,
    }  # fmt: skip
    return Understanding.model_validate({**base, **fields})


def reply(text: str, model: str = "claude-opus-5-5") -> LlmReply:
    return LlmReply(text, model, "stub", Usage(), Decimal(0), "done", "v1")


class FakeModels:
    def __init__(
        self, understood: Understanding | None = None, answer: Sequence[str] = ("Force is ma ", "[1].")
    ):
        self.understood = understood or understanding()
        self.answer = answer
        self.requests: list[LlmRequest] = []
        self.fail: Exception | None = None

    async def stream(self, request: LlmRequest) -> AsyncIterator[str | LlmReply]:
        self.requests.append(request)
        for piece in self.answer:
            yield piece
        if self.fail:
            raise self.fail
        yield reply("".join(self.answer))

    async def complete(self, request: LlmRequest) -> LlmReply:
        self.requests.append(request)
        return reply("Doubt: force", "claude-haiku-5-5")

    async def complete_structured[M: BaseModel](
        self, request: LlmRequest, output: type[M]
    ) -> StructuredReply[M]:
        self.requests.append(request)
        return StructuredReply(output.model_validate(self.understood.model_dump()), reply("{}"))

    async def quote(
        self, org_id: UUID, task: str, usages: Sequence[Usage], *, model_id: str | None = None
    ) -> CostEstimate:
        return CostEstimate(model_id or "claude-opus-5-5", "anthropic", Decimal("0.01") * len(usages))


class FakeContext:
    def __init__(self, transcript: Transcript, teacher: Teacher | None = None) -> None:
        self.the_transcript = transcript
        self.the_teacher = teacher or Teacher(None, None, None)

    async def transcript(self, org_id: UUID, session_id: UUID, up_to_message: UUID) -> Transcript | None:
        return self.the_transcript

    async def teacher(self, org_id: UUID, user_id: UUID) -> Teacher:
        return self.the_teacher

    async def exams(self, org_id: UUID) -> list[Exam]:
        return [Exam("rpsc_2g_p2_science", "RPSC Senior Teacher (2nd Grade), Paper II: Science", None)]

    async def patterns(self, org_id: UUID, exam_code: str) -> list[Pattern]:
        return [PATTERN] if exam_code == "rpsc_2g_p2_science" else []

    async def pattern_by_id(self, org_id: UUID, pattern_id: UUID) -> Pattern | None:
        return PATTERN if pattern_id == PATTERN.id else None

    async def nodes(self, org_id: UUID, *, exam_code: str | None, subjects: Sequence[UUID]) -> list[NodeName]:
        return NODES

    async def node_names(self, org_id: UUID, ids: Sequence[str], language: str) -> dict[str, str]:
        return {
            str(node.id): node.names[1 if language == "hi" else 0] for node in NODES if str(node.id) in ids
        }

    async def bank_counts(
        self, org_id: UUID, node_ids: Sequence[str], qtypes: Sequence[str]
    ) -> dict[str, int]:
        return {str(MOTION): 12}

    async def file_names(self, org_id: UUID, source_ids: Sequence[UUID]) -> dict[UUID, str]:
        return {NOTES: "files/physics-motion-force-hi.pdf"}


class FakeSearch:
    def __init__(self, found: bool = True) -> None:
        self.found = found
        self.requests: list[RetrievalRequest] = []

    async def execute(self, request: RetrievalRequest) -> Retrieved:
        self.requests.append(request)
        passage = Passage(
            uuid4(), NOTES, 3, "बल द्रव्यमान और त्वरण का गुणनफल है: F = ma।", "गति › बल", "गति के नियम", 5, 5,
            "42", "hi", "prose", "notes", "own", None, MOTION,
        )  # fmt: skip
        hits = [Hit(passage, 0.97)] if self.found else []
        return Retrieved(hits, len(hits), True, True)


def chat(*messages: StoredMessage, draft: dict[str, Any] | None = None, title: str = "") -> Transcript:
    return Transcript(title, None, draft, None, list(messages))


def said(text: str) -> StoredMessage:
    return StoredMessage("user", [{"type": "text", "text": text}])


def turn(model: str | None = None) -> TurnRef:
    return TurnRef(uuid4(), uuid4(), uuid4(), uuid4(), uuid4(), model)


async def run(agent: ChatAgent, ref: TurnRef | None = None) -> list[dict[str, Any]]:
    return [event async for event in agent.execute(ref or turn())]


def done(events: list[dict[str, Any]]) -> dict[str, Any]:
    assert events[-1]["event"] == "done", events[-1]
    return events[-1]


async def test_a_full_request_goes_straight_to_the_review_card() -> None:
    models = FakeModels(
        understanding(
            intent="create", kind="question_paper", exam_code="rpsc_2g_p2_science", topics=["gati ke niyam"],
            question_count=40, difficulty="hard",
        )
    )  # fmt: skip
    events = await run(
        ChatAgent(FakeContext(chat(said("RPSC science paper on gati ke niyam"))), models, None)
    )
    end = done(events)
    assert end["sessionStatus"] == "awaiting_input" and end["title"] == "Doubt: force"
    text, review = end["blocks"]
    assert text["text"].startswith("Here is what I'll make") and review["type"] == "spec_review"
    spec = review["spec"]
    assert (spec["examCode"], spec["taxonomyNodeIds"], spec["sections"][0]["count"]) == (
        "rpsc_2g_p2_science",
        [str(MOTION)],
        40,
    )
    assert spec["sections"][0]["difficultyMix"] == DIFFICULTY["hard"] and spec["durationMinutes"] == 50
    assert spec["title"] == "RPSC Senior Teacher (2nd Grade), Paper II: Science: Laws of Motion"
    assert review["availability"] == [
        {"nodeId": str(MOTION), "name": "Laws of Motion", "fromBank": 12, "toGenerate": 28}
    ]
    assert (
        review["estimate"]["usdLow"] > 0
        and review["estimate"]["minutes"] > 0
        and review["confirmedAt"] is None
    )
    drafts = [e["draftSpec"] for e in events if e["event"] == "draft_spec"]
    assert drafts and "title" not in drafts[-1]  # the title stays automatic until the teacher sets one
    assert [r.task for r in models.requests].count("spec") == 1  # the only model call besides the title


async def test_what_is_missing_is_asked_on_cards_and_an_answer_completes_it() -> None:
    models = FakeModels(understanding(intent="create", kind="question_paper", topics=["motion"]))
    end = done(await run(ChatAgent(FakeContext(chat(said("ek paper banao motion par"))), models, None)))
    _, scope, shape = end["blocks"]
    assert (scope["purpose"], shape["purpose"]) == ("scope", "shape")
    nodes_field = next(f for f in scope["fields"] if f["key"] == "taxonomy_nodes")
    assert nodes_field["suggested"] == [] and set(nodes_field["options"]) == {
        str(MOTION),
        str(LINE),
    }  # either

    draft = {"kind": "question_paper", "languages": ["hi", "en"], "layout": "hindi_then_english"}
    answer = StoredMessage(
        "user",
        [{"type": "card_response", "cardId": "scope:x", "summary": "...",
          "values": {"taxonomy_nodes": [str(MOTION)], "exam": "rpsc_2g_p2_science"}}],
    )  # fmt: skip
    card_models = FakeModels()
    end = done(
        await run(ChatAgent(FakeContext(chat(said("ek paper"), answer, draft=draft)), card_models, None))
    )
    assert end["blocks"][-1]["type"] == "spec_review"
    assert end["blocks"][-1]["spec"]["sections"][0]["count"] == 100  # the exam's full pattern
    assert end["blocks"][-1]["spec"]["durationMinutes"] == 120  # and its time
    assert [r.task for r in card_models.requests] == ["chat_title"]  # no model reads a card


async def test_a_doubt_is_answered_from_the_material_with_citations() -> None:
    models = FakeModels(understanding(intent="ask", question="force kya hai"))
    search = FakeSearch()
    teacher = Teacher(None, "hi", None)
    end = done(await run(ChatAgent(FakeContext(chat(said("force kya hai?")), teacher), models, search)))
    text, citations = end["blocks"]
    assert text == {"type": "text", "text": "Force is ma [1]."} and end["modelId"] == "claude-opus-5-5"
    assert citations["type"] == "citations"
    [item] = citations["items"]
    assert (item["filename"], item["pageLabel"], item["sourceId"]) == (
        "physics-motion-force-hi.pdf",
        "42",
        str(NOTES),
    )
    assert search.requests[0].query == "force kya hai" and search.requests[0].language == "hi"
    answer = next(r for r in models.requests if r.task == "chat_qa")
    assert '<passage n="1" source="गति के नियम" page="42">' in answer.context[0].text


async def test_a_doubt_the_material_doesnt_cover_is_not_guessed() -> None:
    models = FakeModels(understanding(intent="ask"))
    end = done(
        await run(ChatAgent(FakeContext(chat(said("मुगल साम्राज्य किसने बनाया?"))), models, FakeSearch(False)))
    )
    assert end["blocks"][0]["text"].startswith("यह आपके संस्थान की सामग्री में नहीं मिला")
    assert "chat_qa" not in [r.task for r in models.requests]


async def test_buttons_confirm_cancel_and_undo() -> None:
    def press(action: str) -> StoredMessage:
        return StoredMessage(
            "user", [{"type": "action", "action": action, "targetId": None, "summary": action}]
        )

    ready = {
        "kind": "notes", "taxonomyNodeIds": [str(MOTION)], "languages": ["en"], "depth": "standard",
        "includeExamples": True, "includePractice": False,
    }  # fmt: skip
    confirmed = done(
        await run(
            ChatAgent(
                FakeContext(chat(said("notes"), press("confirm_spec"), draft=ready)), FakeModels(), None
            )
        )
    )
    assert "isn't switched on yet" in confirmed["blocks"][0]["text"]
    nothing = done(
        await run(ChatAgent(FakeContext(chat(said("hi"), press("confirm_spec"))), FakeModels(), None))
    )
    assert nothing["blocks"][0]["text"].startswith("There's nothing to confirm")
    events = await run(
        ChatAgent(FakeContext(chat(said("notes"), press("cancel"), draft=ready)), FakeModels(), None)
    )
    assert {"event": "draft_spec", "draftSpec": {}} in events and done(events)["sessionStatus"] == "idle"


async def test_failures_end_the_answer_with_an_error_the_teacher_can_read() -> None:
    models = FakeModels(understanding(intent="chat"))
    models.fail = BudgetExceeded(Budget("user", Decimal(5), Decimal(5)))
    events = await run(ChatAgent(FakeContext(chat(said("hello"))), models, None))
    assert events[-1] == {
        "event": "error",
        "code": "budget_exceeded",
        "message": "Your monthly AI budget of US$5.00 is used up",
    }
    models = FakeModels(understanding(intent="chat"))
    models.fail = ProviderError("overloaded", retryable=True)
    assert (await run(ChatAgent(FakeContext(chat(said("hello"))), models, None)))[-1][
        "code"
    ] == "provider_error"


def test_the_internal_endpoint_streams_contract_events_as_lines() -> None:
    body = {
        "orgId": str(uuid4()),
        "userId": str(uuid4()),
        "sessionId": str(uuid4()),
        "turnId": str(uuid4()),
        "userMessageId": str(uuid4()),
        "modelId": None,
    }
    models = FakeModels(understanding(intent="create", kind="notes", topics=["gati ke niyam"]))
    with TestClient(create_app(settings())) as client:
        client.app.state.chat_agent = ChatAgent(
            FakeContext(chat(said("notes on gati ke niyam"))), models, None
        )  # type: ignore[attr-defined]
        assert client.post("/chat/turns", json=body).status_code == 401
        response = client.post("/chat/turns", json=body, headers={"x-vidyam-service-token": TOKEN})
        assert response.headers["content-type"].startswith("application/x-ndjson")
        lines = [json.loads(line) for line in response.text.splitlines()]
    assert [line["event"] for line in lines] == ["draft_spec", "text_delta", "block", "done"]
    # Fields the draft doesn't have yet are left out, not sent as null (the API's contract has them optional).
    draft = lines[0]["draftSpec"]
    assert (
        "sections" not in draft and "setCodes" not in draft and draft["examCode"] is None
    )  # null where allowed
    assert lines[2]["block"]["type"] == "spec_review" and lines[-1]["sessionStatus"] == "awaiting_input"
