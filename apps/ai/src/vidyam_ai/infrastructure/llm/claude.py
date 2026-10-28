"""Claude through the Anthropic SDK: the Claude API with a key, or Claude Platform on AWS with the task's AWS
credentials (VIDYAM_CLAUDE_ENDPOINT=aws). Same requests either way.

Thinking is left to the model's default (adaptive on every current Claude model); `output_config.effort`
controls how deep it goes. System blocks carry cache_control on the last block of each cache lifetime.
"""

import base64
from collections.abc import AsyncIterator, Sequence
from typing import Any, cast

import anthropic
from anthropic import AsyncAnthropic
from anthropic.types import Message

from vidyam_ai.application.llm_gateway import BatchStatus, ProviderError
from vidyam_ai.domain.llm import BatchResult, Completion, Finish, ModelCall, Segment, Turn, Usage
from vidyam_ai.infrastructure.llm.schemas import anthropic_schema

_FINISH: dict[str, Finish] = {
    "end_turn": "done",
    "stop_sequence": "done",
    "max_tokens": "max_tokens",
    "refusal": "refusal",
}
_RETRYABLE = (
    anthropic.APIConnectionError,
    anthropic.RateLimitError,
    anthropic.InternalServerError,
    anthropic.OverloadedError,
    anthropic.ServiceUnavailableError,
    anthropic.DeadlineExceededError,
)


def _content(turn: Turn) -> str | list[dict[str, Any]]:
    """Plain text, or image blocks followed by the text (Claude reads images best before the question)."""
    if not turn.images:
        return turn.text
    images: list[dict[str, Any]] = [
        {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": image.media_type,
                "data": base64.b64encode(image.data).decode(),
            },
        }
        for image in turn.images
    ]
    return [*images, {"type": "text", "text": turn.text}]


def message_params(call: ModelCall) -> dict[str, Any]:
    params: dict[str, Any] = {
        "model": call.model,
        "max_tokens": call.max_tokens,
        "messages": [{"role": turn.role, "content": _content(turn)} for turn in call.turns],
    }
    if call.system:
        params["system"] = _system_blocks(call.system)
    config: dict[str, Any] = {}
    if call.effort:
        config["effort"] = call.effort
    if call.output:
        config["format"] = {"type": "json_schema", "schema": anthropic_schema(call.output.schema)}
    if config:
        params["output_config"] = config
    return params


def _system_blocks(segments: Sequence[Segment]) -> list[dict[str, Any]]:
    """A cache breakpoint caches everything before it, so one on the last block of each lifetime is enough
    (and stays within the API's four breakpoints)."""
    blocks: list[dict[str, Any]] = []
    for i, segment in enumerate(segments):
        block: dict[str, Any] = {"type": "text", "text": segment.text}
        following = segments[i + 1].cache if i + 1 < len(segments) else None
        if segment.cache and segment.cache != following:
            block["cache_control"] = {"type": "ephemeral", "ttl": segment.cache}
        blocks.append(block)
    return blocks


def completion(message: Message) -> Completion:
    usage = message.usage
    created = usage.cache_creation
    written_5m = created.ephemeral_5m_input_tokens if created else (usage.cache_creation_input_tokens or 0)
    written_1h = created.ephemeral_1h_input_tokens if created else 0
    reason = message.stop_reason
    return Completion(
        text="".join(block.text for block in message.content if block.type == "text"),
        usage=Usage(
            input_tokens=usage.input_tokens,
            cache_read_tokens=usage.cache_read_input_tokens or 0,
            cache_write_5m_tokens=written_5m,
            cache_write_1h_tokens=written_1h,
            output_tokens=usage.output_tokens,
        ),
        finish=_FINISH.get(reason or "", "other"),
        stop_reason=reason,
        request_id=getattr(message, "_request_id", None),
    )


def _error(error: anthropic.AnthropicError) -> ProviderError:
    retryable = isinstance(error, _RETRYABLE) or (
        isinstance(error, anthropic.APIStatusError) and error.status_code >= 500
    )
    request_id = error.request_id if isinstance(error, anthropic.APIStatusError) else None
    return ProviderError(f"Claude: {error}", retryable=retryable, request_id=request_id)


class AnthropicProvider:
    def __init__(self, client: AsyncAnthropic) -> None:
        self._client = client

    async def complete(self, call: ModelCall) -> Completion:
        try:
            return completion(cast(Message, await self._client.messages.create(**message_params(call))))
        except anthropic.AnthropicError as error:
            raise _error(error) from error

    async def stream(self, call: ModelCall) -> AsyncIterator[str | Completion]:
        try:
            async with self._client.messages.stream(**message_params(call)) as stream:
                async for text in stream.text_stream:
                    yield text
                message = await stream.get_final_message()
        except anthropic.AnthropicError as error:
            raise _error(error) from error
        yield completion(message)

    async def submit_batch(self, calls: Sequence[tuple[str, ModelCall]]) -> str:
        requests: list[Any] = [{"custom_id": cid, "params": message_params(call)} for cid, call in calls]
        try:
            batch = await self._client.messages.batches.create(requests=requests)
        except anthropic.AnthropicError as error:
            raise _error(error) from error
        return batch.id

    async def batch_status(self, batch_id: str) -> BatchStatus:
        try:
            batch = await self._client.messages.batches.retrieve(batch_id)
        except anthropic.AnthropicError as error:
            raise _error(error) from error
        return "ended" if batch.processing_status == "ended" else "running"

    async def batch_results(self, batch_id: str) -> Sequence[BatchResult]:
        results: list[BatchResult] = []
        try:
            async for item in await self._client.messages.batches.results(batch_id):
                outcome = item.result
                if outcome.type == "succeeded":
                    results.append(BatchResult(item.custom_id, completion(outcome.message)))
                elif outcome.type == "errored":
                    detail = outcome.error.error
                    results.append(BatchResult(item.custom_id, None, f"{detail.type}: {detail.message}"))
                else:
                    results.append(BatchResult(item.custom_id, None, outcome.type))  # canceled or expired
        except anthropic.AnthropicError as error:
            raise _error(error) from error
        return results
