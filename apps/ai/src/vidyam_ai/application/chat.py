"""Answering a chat turn (plan v3 §6, ADR 0015).

The API records the teacher's message, then asks for an answer by ids only. This reads the conversation
(never writes it: the API is the single writer), streams the answer as events, and ends with `done`, which
carries the whole answer for the API to store. A new chat is named alongside its first answer.

For now the answer is the `chat_qa` task over the conversation. The chat agent (step 23) adds intents,
clarification cards, search with citations and the paper spec.
"""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from typing import Any, Protocol
from uuid import UUID

from vidyam_ai.application.llm_gateway import (
    BudgetExceeded,
    Caller,
    LlmError,
    LlmReply,
    LlmRequest,
    ModelNotAllowed,
    ModelUnavailable,
    ProviderError,
    ProviderNotConfigured,
)
from vidyam_ai.domain.chat import StoredMessage, conversation, first_question, language_of

log = logging.getLogger(__name__)

Event = dict[str, Any]  # a ChatEngineEvent, as sent


@dataclass(frozen=True)
class Transcript:
    title: str
    model_override: str | None
    messages: Sequence[StoredMessage]  # oldest first, ending with the teacher's message being answered


class ChatTranscripts(Protocol):
    """Port: a chat as stored (read-only)."""

    async def load(self, org_id: UUID, session_id: UUID, up_to_message: UUID) -> Transcript | None: ...


class ChatModels(Protocol):
    """Port: the LLM gateway."""

    def stream(self, request: LlmRequest) -> AsyncIterator[str | LlmReply]: ...
    async def complete(self, request: LlmRequest) -> LlmReply: ...


@dataclass(frozen=True)
class TurnRef:
    org_id: UUID
    user_id: UUID
    session_id: UUID
    turn_id: UUID
    user_message_id: UUID
    model_id: str | None


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


class AnswerTurn:
    def __init__(self, transcripts: ChatTranscripts, models: ChatModels) -> None:
        self._transcripts = transcripts
        self._models = models

    async def execute(self, turn: TurnRef) -> AsyncIterator[Event]:
        transcript = await self._transcripts.load(turn.org_id, turn.session_id, turn.user_message_id)
        if transcript is None or not transcript.messages or transcript.messages[-1].role != "user":
            yield error("not_found", "That message isn't in this chat.")
            return
        caller = Caller(turn.org_id, turn.user_id, chat_session_id=turn.session_id, turn_id=turn.turn_id)
        question = first_question(transcript.messages)
        naming = None if transcript.title else asyncio.create_task(self._title(caller, question))
        try:
            request = LlmRequest(
                caller=caller,
                task="chat_qa",
                turns=conversation(transcript.messages),
                model_id=turn.model_id or transcript.model_override,
                prompt_cache="5m",
            )
            text: list[str] = []
            reply: LlmReply | None = None
            try:
                async for item in self._models.stream(request):
                    if isinstance(item, str):
                        text.append(item)
                        yield {"event": "text_delta", "text": item}
                    else:
                        reply = item
            except (LlmError, ProviderError) as problem:
                yield _failure(problem)
                return
            title = await naming if naming else None
            yield {
                "event": "done",
                "blocks": [{"type": "text", "text": "".join(text)}],
                "modelId": reply.model_id if reply else None,
                "title": title,
                "sessionStatus": "idle",
            }
        finally:
            if naming and not naming.done():
                naming.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await naming

    async def _title(self, caller: Caller, question: str) -> str | None:
        """A short name for a new chat; without one the chat keeps its placeholder."""
        try:
            reply = await self._models.complete(
                LlmRequest(
                    caller=caller,
                    task="chat_title",
                    variables={"first_message": question, "language": language_of(question)},
                )
            )
        except (LlmError, ProviderError) as problem:
            log.warning("chat title: %s", problem)
            return None
        title = reply.text.strip().strip('"“”').strip()
        return title[:120] or None
