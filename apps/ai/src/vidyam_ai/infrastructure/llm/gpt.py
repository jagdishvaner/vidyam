"""GPT through the OpenAI Responses API. The system blocks become `instructions` (the stable prefix OpenAI
caches on its own); `prompt_cache_key` keeps requests that share a prefix on the same cache. Nothing is stored
on OpenAI's side (store=False).

Strict structured outputs need every property required, so optional ones are sent as nullable; the gateway
drops those nulls again before validating the reply.
"""

import json
from collections.abc import AsyncIterator, Sequence
from typing import Any, cast

import openai
from openai import AsyncOpenAI
from openai.types.responses import (
    Response,
    ResponseCompletedEvent,
    ResponseErrorEvent,
    ResponseFailedEvent,
    ResponseIncompleteEvent,
    ResponseTextDeltaEvent,
)

from vidyam_ai.application.llm_gateway import BatchStatus, ProviderError
from vidyam_ai.domain.llm import BatchResult, Completion, Finish, ModelCall, Usage
from vidyam_ai.infrastructure.llm.schemas import openai_strict_schema

_ENDPOINT = "/v1/responses"
_ENDED = frozenset({"completed", "failed", "expired", "cancelled"})
_RETRYABLE = (openai.APIConnectionError, openai.RateLimitError, openai.InternalServerError)


def response_params(call: ModelCall) -> dict[str, Any]:
    params: dict[str, Any] = {
        "model": call.model,
        "input": [{"role": turn.role, "content": turn.text} for turn in call.turns],
        "max_output_tokens": call.max_tokens,
        "store": False,
    }
    if call.system:
        params["instructions"] = "\n\n".join(segment.text for segment in call.system)
    if call.effort:
        params["reasoning"] = {"effort": call.effort}
    if call.output:
        params["text"] = {
            "format": {
                "type": "json_schema",
                "name": call.output.name[:64],
                "schema": openai_strict_schema(call.output.schema),
                "strict": True,
            }
        }
    if call.cache_key:
        params["prompt_cache_key"] = call.cache_key
    return params


def completion(response: Response) -> Completion:
    refused = any(
        part.type == "refusal" for item in response.output if item.type == "message" for part in item.content
    )
    usage = response.usage
    finish: Finish
    if refused:
        finish, reason = "refusal", "refusal"
    elif response.status == "completed":
        finish, reason = "done", "completed"
    else:
        reason = response.incomplete_details.reason if response.incomplete_details else None
        finish = (
            "max_tokens"
            if reason == "max_output_tokens"
            else "refusal"
            if reason == "content_filter"
            else "other"
        )
        reason = reason or response.status
    if usage is None:
        counted = Usage()
    else:
        details = usage.input_tokens_details
        counted = Usage(
            input_tokens=usage.input_tokens - details.cached_tokens - details.cache_write_tokens,
            cache_read_tokens=details.cached_tokens,
            cache_write_5m_tokens=details.cache_write_tokens,  # OpenAI's default 30-minute cache
            output_tokens=usage.output_tokens,
        )
    return Completion(response.output_text, counted, finish, reason, getattr(response, "_request_id", None))


def _error(error: openai.OpenAIError) -> ProviderError:
    retryable = isinstance(error, _RETRYABLE) or (
        isinstance(error, openai.APIStatusError) and error.status_code >= 500
    )
    request_id = error.request_id if isinstance(error, openai.APIStatusError) else None
    return ProviderError(f"OpenAI: {error}", retryable=retryable, request_id=request_id)


class OpenAiProvider:
    def __init__(self, client: AsyncOpenAI) -> None:
        self._client = client

    async def complete(self, call: ModelCall) -> Completion:
        try:
            response = cast(Response, await self._client.responses.create(**response_params(call)))
        except openai.OpenAIError as error:
            raise _error(error) from error
        return completion(response)

    async def stream(self, call: ModelCall) -> AsyncIterator[str | Completion]:
        final: Response | None = None
        try:
            events = await self._client.responses.create(**response_params(call), stream=True)
            async for event in events:
                if isinstance(event, ResponseTextDeltaEvent):
                    yield event.delta
                elif isinstance(event, ResponseCompletedEvent | ResponseIncompleteEvent):
                    final = event.response
                elif isinstance(event, ResponseFailedEvent):
                    problem = event.response.error
                    raise ProviderError(
                        f"OpenAI: {problem.message if problem else 'the response failed'}", retryable=True
                    )
                elif isinstance(event, ResponseErrorEvent):
                    raise ProviderError(f"OpenAI: {event.message}", retryable=True)
        except openai.OpenAIError as error:
            raise _error(error) from error
        if final is None:
            raise ProviderError("OpenAI: the stream ended without a response", retryable=True)
        yield completion(final)

    async def submit_batch(self, calls: Sequence[tuple[str, ModelCall]]) -> str:
        lines = [
            json.dumps({"custom_id": cid, "method": "POST", "url": _ENDPOINT, "body": response_params(call)})
            for cid, call in calls
        ]
        try:
            upload = await self._client.files.create(
                file=("batch.jsonl", "\n".join(lines).encode()), purpose="batch"
            )
            batch = await self._client.batches.create(
                input_file_id=upload.id, endpoint=_ENDPOINT, completion_window="24h"
            )
        except openai.OpenAIError as error:
            raise _error(error) from error
        return batch.id

    async def batch_status(self, batch_id: str) -> BatchStatus:
        try:
            batch = await self._client.batches.retrieve(batch_id)
        except openai.OpenAIError as error:
            raise _error(error) from error
        return "ended" if batch.status in _ENDED else "running"

    async def batch_results(self, batch_id: str) -> Sequence[BatchResult]:
        try:
            batch = await self._client.batches.retrieve(batch_id)
            output = await self._read(batch.output_file_id)
            errors = await self._read(batch.error_file_id)
        except openai.OpenAIError as error:
            raise _error(error) from error
        results: list[BatchResult] = []
        for line in output + errors:
            custom_id = str(line["custom_id"])
            response = cast(dict[str, Any], line.get("response") or {})
            body = cast(dict[str, Any], response.get("body") or {})
            failed = line.get("error") or not body or int(response.get("status_code", 200)) >= 400
            if failed:
                problem = cast(dict[str, Any], line.get("error") or body.get("error") or {})
                message = str(problem.get("message") or "the request failed")
                results.append(BatchResult(custom_id, None, message))
                continue
            results.append(BatchResult(custom_id, completion(Response.model_construct(**body))))
        return results

    async def _read(self, file_id: str | None) -> list[dict[str, Any]]:
        if not file_id:
            return []
        content = await self._client.files.content(file_id)
        return [json.loads(line) for line in content.text.splitlines() if line.strip()]
