"""The Claude and OpenAI adapters against provider-shaped HTTP responses (no keys, no network): what they
send, how they read usage and stop reasons, streaming, batches, and which failures count as retryable."""

import json
from collections.abc import Callable
from typing import Any

import httpx2
import pytest
from anthropic import AsyncAnthropic
from openai import AsyncOpenAI
from vidyam_ai.application.llm_gateway import ProviderError
from vidyam_ai.domain.llm import Completion, ModelCall, OutputSchema, Segment, Turn, Usage
from vidyam_ai.infrastructure.llm.claude import AnthropicProvider
from vidyam_ai.infrastructure.llm.gpt import OpenAiProvider

from tests.fixtures import llm_responses as fx

type Handler = Callable[[httpx2.Request], httpx2.Response]

DRAFT_SCHEMA: dict[str, Any] = {
    "title": "Draft",
    "type": "object",
    "properties": {
        "stem": {"type": "string", "minLength": 1, "title": "Stem"},
        "options": {"type": "array", "items": {"type": "string"}, "minItems": 2},
        "answer": {"type": "integer", "minimum": 0},
        "hint": {"anyOf": [{"type": "string"}, {"type": "null"}], "default": None},
    },
    "required": ["stem", "options", "answer"],
}

CALL = ModelCall(
    model="claude-opus-5-5",
    system=(Segment("rules", "1h"), Segment("style pack", "1h"), Segment("evidence", "5m"), Segment("slot")),
    turns=(Turn("user", "write it"),),
    max_tokens=8_000,
    effort="high",
    output=OutputSchema("Draft", DRAFT_SCHEMA),
    cache_key="generate:rpsc-2g",
)


class Recorder:
    def __init__(self, handler: Handler) -> None:
        self.requests: list[httpx2.Request] = []
        self._handler = handler

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        return self._handler(request)

    def body(self, i: int = 0) -> dict[str, Any]:
        return json.loads(self.requests[i].content)


def claude(handler: Handler) -> tuple[AnthropicProvider, Recorder]:
    recorder = Recorder(handler)
    http = httpx2.AsyncClient(transport=httpx2.MockTransport(recorder))
    return AnthropicProvider(AsyncAnthropic(api_key="test", http_client=http, max_retries=0)), recorder


def gpt(handler: Handler) -> tuple[OpenAiProvider, Recorder]:
    recorder = Recorder(handler)
    http = httpx2.AsyncClient(transport=httpx2.MockTransport(recorder))
    return OpenAiProvider(AsyncOpenAI(api_key="test", http_client=http, max_retries=0)), recorder


def ok(body: Any, **headers: str) -> httpx2.Response:
    return httpx2.Response(200, json=body, headers=headers)


# Claude


async def test_claude_request_caches_each_lifetime_and_asks_for_the_schema() -> None:
    provider, sent = claude(lambda _: ok(fx.CLAUDE_MESSAGE, **{"request-id": "req_123"}))
    done = await provider.complete(CALL)

    body = sent.body()
    assert sent.requests[0].url.path == "/v1/messages"
    assert [block.get("cache_control") for block in body["system"]] == [
        None,
        {"type": "ephemeral", "ttl": "1h"},  # one breakpoint per lifetime: the end of the 1-hour run
        {"type": "ephemeral", "ttl": "5m"},
        None,
    ]
    assert body["messages"] == [{"role": "user", "content": "write it"}]
    assert "thinking" not in body  # adaptive thinking is the model's default; effort sets its depth
    config = body["output_config"]
    assert config["effort"] == "high"
    schema = config["format"]["schema"]
    assert config["format"]["type"] == "json_schema"
    assert schema["additionalProperties"] is False
    assert "minLength" not in schema["properties"]["stem"] and "minimum" not in schema["properties"]["answer"]
    assert schema["properties"]["options"]["minItems"] == 1

    assert json.loads(done.text) == fx.DRAFT  # the thinking block is not part of the reply
    assert done.usage == Usage(
        input_tokens=120,
        cache_read_tokens=9_000,
        cache_write_5m_tokens=1_000,
        cache_write_1h_tokens=2_000,
        output_tokens=450,
    )
    assert (done.finish, done.stop_reason, done.request_id) == ("done", "end_turn", "req_123")


async def test_claude_refusals_and_cut_off_replies_are_reported() -> None:
    for reason, finish in (("refusal", "refusal"), ("max_tokens", "max_tokens"), ("pause_turn", "other")):
        provider, _ = claude(lambda _, r=reason: ok({**fx.CLAUDE_MESSAGE, "stop_reason": r}))
        assert (await provider.complete(CALL)).finish == finish


async def test_claude_overloads_are_retryable_and_bad_requests_are_not() -> None:
    provider, _ = claude(
        lambda _: httpx2.Response(529, json=fx.CLAUDE_OVERLOADED, headers={"request-id": "req_9"})
    )
    with pytest.raises(ProviderError) as overloaded:
        await provider.complete(CALL)
    assert overloaded.value.retryable and overloaded.value.request_id == "req_9"

    provider, _ = claude(lambda _: httpx2.Response(400, json=fx.CLAUDE_BAD_REQUEST))
    with pytest.raises(ProviderError, match="max_tokens: too large") as rejected:
        await provider.complete(CALL)
    assert not rejected.value.retryable

    def offline(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("no route to host", request=request)

    provider, _ = claude(offline)
    with pytest.raises(ProviderError) as unreachable:
        await provider.complete(CALL)
    assert unreachable.value.retryable


async def test_claude_streams_text_then_the_finished_message() -> None:
    stream = fx.sse(fx.CLAUDE_STREAM)
    provider, _ = claude(
        lambda _: httpx2.Response(200, content=stream, headers={"content-type": "text/event-stream"})
    )
    items = [item async for item in provider.stream(CALL)]
    assert items[:2] == ["Ohm's ", "law"]
    final = items[2]
    assert isinstance(final, Completion)
    assert (final.text, final.finish, final.usage.output_tokens) == ("Ohm's law", "done", 12)


async def test_claude_batches_submit_poll_and_read_every_kind_of_result() -> None:
    def api(request: httpx2.Request) -> httpx2.Response:
        path = request.url.path
        if request.method == "POST" and path == "/v1/messages/batches":
            return ok(fx.claude_batch("in_progress"))
        if path == "/v1/messages/batches/msgbatch_01":
            return ok(fx.claude_batch("ended"))
        if path == "/v1/messages/batches/msgbatch_01/results":
            return httpx2.Response(200, content=fx.jsonl(fx.CLAUDE_BATCH_RESULTS))
        return httpx2.Response(
            404, json={"type": "error", "error": {"type": "not_found_error", "message": path}}
        )

    provider, sent = claude(api)
    assert await provider.submit_batch([("q-1", CALL), ("q-2", CALL)]) == "msgbatch_01"
    requests = sent.body()["requests"]
    assert [r["custom_id"] for r in requests] == ["q-1", "q-2"]
    assert requests[0]["params"]["output_config"]["effort"] == "high"

    assert await provider.batch_status("msgbatch_01") == "ended"
    first, second, third = await provider.batch_results("msgbatch_01")
    assert first.completion is not None and json.loads(first.completion.text) == fx.DRAFT
    assert (second.completion, second.error) == (None, "invalid_request_error: prompt is too long")
    assert (third.completion, third.error) == (None, "expired")


# OpenAI


async def test_gpt_request_uses_instructions_strict_schema_and_cache_key() -> None:
    provider, sent = gpt(lambda _: ok(fx.gpt_response(), **{"x-request-id": "req_abc"}))
    done = await provider.complete(CALL)

    body = sent.body()
    assert sent.requests[0].url.path == "/v1/responses"
    assert body["instructions"] == "rules\n\nstyle pack\n\nevidence\n\nslot"
    assert body["input"] == [{"role": "user", "content": "write it"}]
    assert body["reasoning"] == {"effort": "high"}
    assert (body["store"], body["max_output_tokens"], body["prompt_cache_key"]) == (
        False,
        8_000,
        "generate:rpsc-2g",
    )
    fmt = body["text"]["format"]
    assert (fmt["type"], fmt["name"], fmt["strict"]) == ("json_schema", "Draft", True)
    schema = fmt["schema"]
    assert schema["required"] == ["stem", "options", "answer", "hint"]  # strict: every property required
    assert schema["properties"]["hint"] == {"anyOf": [{"type": "string"}, {"type": "null"}]}
    assert schema["properties"]["options"]["minItems"] == 2  # OpenAI enforces array sizes itself

    assert json.loads(done.text) == fx.DRAFT
    # 5,000 input tokens in all: 3,000 read from the cache and 1,000 written to it.
    assert done.usage == Usage(
        input_tokens=1_000, cache_read_tokens=3_000, cache_write_5m_tokens=1_000, output_tokens=800
    )
    assert (done.finish, done.request_id) == ("done", "req_abc")


async def test_gpt_cut_off_and_refused_replies_are_reported() -> None:
    provider, _ = gpt(lambda _: ok(fx.gpt_response(status="incomplete", incomplete="max_output_tokens")))
    done = await provider.complete(CALL)
    assert (done.finish, done.stop_reason) == ("max_tokens", "max_output_tokens")

    provider, _ = gpt(lambda _: ok(fx.gpt_response(refusal=True)))
    assert (await provider.complete(CALL)).finish == "refusal"


async def test_gpt_rate_limits_are_retryable() -> None:
    provider, _ = gpt(lambda _: httpx2.Response(429, json=fx.GPT_RATE_LIMITED))
    with pytest.raises(ProviderError, match="Rate limit") as limited:
        await provider.complete(CALL)
    assert limited.value.retryable


async def test_gpt_streams_text_then_the_finished_response() -> None:
    stream = fx.sse(fx.GPT_STREAM)
    provider, sent = gpt(
        lambda _: httpx2.Response(200, content=stream, headers={"content-type": "text/event-stream"})
    )
    items = [item async for item in provider.stream(CALL)]
    assert sent.body()["stream"] is True
    assert items[:2] == ["Ohm's ", "law"]
    final = items[2]
    assert isinstance(final, Completion) and final.text == "Ohm's law"


async def test_gpt_batches_upload_a_file_and_read_results_and_errors() -> None:
    def api(request: httpx2.Request) -> httpx2.Response:
        path = request.url.path
        if path == "/v1/files" and request.method == "POST":
            return ok(fx.GPT_FILE)
        if path == "/v1/batches" and request.method == "POST":
            return ok(fx.gpt_batch("validating"))
        if path == "/v1/batches/batch_01":
            return ok(fx.gpt_batch("completed"))
        if path == "/v1/files/file-out/content":
            return httpx2.Response(200, content=fx.jsonl(fx.GPT_BATCH_OUTPUT))
        if path == "/v1/files/file-err/content":
            return httpx2.Response(200, content=fx.jsonl(fx.GPT_BATCH_ERRORS))
        return httpx2.Response(404, json={"error": {"message": path}})

    provider, sent = gpt(api)
    assert await provider.submit_batch([("q-1", CALL)]) == "batch_01"
    upload = sent.requests[0].content.decode()
    line = json.loads(next(part for part in upload.split("\r\n") if part.startswith("{")))
    assert (line["custom_id"], line["url"], line["body"]["model"]) == (
        "q-1",
        "/v1/responses",
        "claude-opus-5-5",
    )
    assert sent.body(1) == {
        "input_file_id": "file-in",
        "endpoint": "/v1/responses",
        "completion_window": "24h",
    }

    assert await provider.batch_status("batch_01") == "ended"
    first, second, third = await provider.batch_results("batch_01")
    assert first.completion is not None and first.completion.usage.cache_read_tokens == 3_000
    assert (second.custom_id, second.error) == ("q-2", "Invalid schema")
    assert (third.custom_id, third.error) == ("q-3", "expired")
