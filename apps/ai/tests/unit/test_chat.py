"""Answering a chat turn (plan v3 §6, ADR 0015): the conversation as models read it, the streamed answer with
a title for a new chat, failures as error events, and the internal NDJSON endpoint."""

import json
from collections.abc import AsyncIterator, Sequence
from decimal import Decimal
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from vidyam_ai.application.chat import AnswerTurn, Transcript, TurnRef
from vidyam_ai.application.llm_gateway import BudgetExceeded, LlmReply, LlmRequest, ProviderError
from vidyam_ai.domain.chat import StoredMessage, conversation, first_question, language_of, message_text
from vidyam_ai.domain.llm import Budget, Turn, Usage
from vidyam_ai.interface.http.app import create_app

from tests.unit.test_http import TOKEN, settings


def test_a_message_reads_as_its_words_answers_and_sources() -> None:
    blocks = [
        {"type": "text", "text": "त्वरण क्या है?"},
        {"type": "clarification", "cardId": "c1", "purpose": "scope", "fields": [{"key": "exam"}]},
        {"type": "card_response", "cardId": "c1", "values": {}, "summary": "Exam: REET Level 2"},
        {
            "type": "citations",
            "items": [{"filename": "motion.pdf", "pageLabel": "42", "pageStart": 3}, {"filename": "x.docx"}],
        },
        {"type": "progress", "runId": str(uuid4()), "stage": "generate", "done": 1, "total": 2},
    ]
    assert message_text(blocks) == ("त्वरण क्या है?\n\nExam: REET Level 2\n\nSources: motion.pdf, p. 42; x.docx")


def test_the_conversation_alternates_and_skips_what_models_cant_read() -> None:
    messages = [
        StoredMessage("user", [{"type": "text", "text": "hello"}]),
        StoredMessage("assistant", [{"type": "error", "code": "x", "message": "failed"}]),  # nothing to read
        StoredMessage("user", [{"type": "text", "text": "Ohm's law?"}]),
        StoredMessage("assistant", [{"type": "text", "text": "V = IR."}]),
        StoredMessage("user", [{"type": "text", "text": "an example?"}]),
    ]
    assert conversation(messages) == [
        Turn("user", "hello\n\nOhm's law?"),
        Turn("assistant", "V = IR."),
        Turn("user", "an example?"),
    ]
    assert first_question(messages) == "hello"
    assert (language_of("न्यूटन का तीसरा नियम"), language_of("newton ka teesra niyam")) == ("Hindi", "English")


def reply(text: str, model: str = "claude-opus-5-5") -> LlmReply:
    return LlmReply(text, model, "stub", Usage(), Decimal(0), "done", "v1")


class FakeTranscripts:
    def __init__(self, transcript: Transcript | None) -> None:
        self.transcript = transcript

    async def load(self, org_id: UUID, session_id: UUID, up_to_message: UUID) -> Transcript | None:
        return self.transcript


class FakeModels:
    def __init__(
        self, pieces: Sequence[str] = ("Acceleration ", "is the rate of change of velocity.")
    ) -> None:
        self.pieces = pieces
        self.requests: list[LlmRequest] = []
        self.fail: Exception | None = None
        self.title_fails = False

    async def stream(self, request: LlmRequest) -> AsyncIterator[str | LlmReply]:
        self.requests.append(request)
        for piece in self.pieces:
            yield piece
        if self.fail:
            raise self.fail
        yield reply("".join(self.pieces))

    async def complete(self, request: LlmRequest) -> LlmReply:
        self.requests.append(request)
        if self.title_fails:
            raise ProviderError("timeout", retryable=True)
        return reply('"Doubt: acceleration"', "claude-haiku-5-5")


def turn(model: str | None = None) -> TurnRef:
    return TurnRef(uuid4(), uuid4(), uuid4(), uuid4(), uuid4(), model)


def chat(title: str = "") -> Transcript:
    return Transcript(
        title, "gpt-6-astra", [StoredMessage("user", [{"type": "text", "text": "what is acceleration"}])]
    )


async def events(answer: AnswerTurn, ref: TurnRef) -> list[dict[str, object]]:
    return [event async for event in answer.execute(ref)]


async def test_an_answer_streams_then_arrives_whole_with_a_title_for_a_new_chat() -> None:
    models = FakeModels()
    ref = turn()
    got = await events(AnswerTurn(FakeTranscripts(chat()), models), ref)
    assert [e["event"] for e in got] == ["text_delta", "text_delta", "done"]
    assert got[-1] == {
        "event": "done",
        "blocks": [{"type": "text", "text": "Acceleration is the rate of change of velocity."}],
        "modelId": "claude-opus-5-5",
        "title": "Doubt: acceleration",
        "sessionStatus": "idle",
    }
    [answer, title] = sorted(models.requests, key=lambda r: r.task)
    assert (answer.task, answer.model_id, answer.turns[-1].text) == (
        "chat_qa",
        "gpt-6-astra",
        "what is acceleration",
    )
    assert answer.caller.turn_id == ref.turn_id and answer.caller.chat_session_id == ref.session_id
    assert title.variables == {"first_message": "what is acceleration", "language": "English"}


async def test_a_named_chat_isnt_renamed_and_the_turns_model_wins() -> None:
    models = FakeModels()
    got = await events(AnswerTurn(FakeTranscripts(chat("Ohm's law")), models), turn("claude-sonnet-5-5"))
    assert got[-1]["title"] is None
    assert [r.task for r in models.requests] == ["chat_qa"] and models.requests[
        0
    ].model_id == "claude-sonnet-5-5"


async def test_failures_end_the_answer_with_an_error_the_teacher_can_read() -> None:
    models = FakeModels()
    models.fail = BudgetExceeded(Budget("user", Decimal(5), Decimal(5)))
    got = await events(AnswerTurn(FakeTranscripts(chat()), models), turn())
    assert got[-1] == {
        "event": "error",
        "code": "budget_exceeded",
        "message": "Your monthly AI budget of US$5.00 is used up",
    }
    models = FakeModels()
    models.title_fails = True  # a chat without a name still gets its answer
    assert (await events(AnswerTurn(FakeTranscripts(chat()), models), turn()))[-1]["title"] is None
    missing = await events(AnswerTurn(FakeTranscripts(None), FakeModels()), turn())
    assert missing == [{"event": "error", "code": "not_found", "message": "That message isn't in this chat."}]


def test_the_internal_endpoint_streams_contract_events_as_lines() -> None:
    body = {
        "orgId": str(uuid4()),
        "userId": str(uuid4()),
        "sessionId": str(uuid4()),
        "turnId": str(uuid4()),
        "userMessageId": str(uuid4()),
        "modelId": None,
    }
    with TestClient(create_app(settings())) as client:
        client.app.state.answer_turn = AnswerTurn(FakeTranscripts(chat()), FakeModels())  # type: ignore[attr-defined]
        assert client.post("/chat/turns", json=body).status_code == 401
        response = client.post("/chat/turns", json=body, headers={"x-vidyam-service-token": TOKEN})
        assert response.headers["content-type"].startswith("application/x-ndjson")
        lines = [json.loads(line) for line in response.text.splitlines()]
    assert [line["event"] for line in lines] == ["text_delta", "text_delta", "done"]
    assert lines[-1]["sessionStatus"] == "idle" and lines[-1]["title"] == "Doubt: acceleration"
