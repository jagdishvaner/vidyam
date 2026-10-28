"""Provider responses in the shapes the Claude and OpenAI APIs document, for adapter tests without keys or
network. Phase B replaces the bodies with recordings from the first live smoke test where they differ."""

import json
from typing import Any

DRAFT = {"stem": "What is the SI unit of force?", "options": ["newton", "joule"], "answer": 0}

CLAUDE_MESSAGE: dict[str, Any] = {
    "id": "msg_01",
    "type": "message",
    "role": "assistant",
    "model": "claude-opus-5-5",
    "content": [
        {"type": "thinking", "thinking": "", "signature": "sig"},  # thinking text is omitted by default
        {"type": "text", "text": json.dumps(DRAFT)},
    ],
    "stop_reason": "end_turn",
    "stop_sequence": None,
    "usage": {
        "input_tokens": 120,
        "cache_creation_input_tokens": 3_000,
        "cache_read_input_tokens": 9_000,
        "cache_creation": {"ephemeral_5m_input_tokens": 1_000, "ephemeral_1h_input_tokens": 2_000},
        "output_tokens": 450,
    },
}

CLAUDE_STREAM = [
    (
        "message_start",
        {
            "type": "message_start",
            "message": {
                **{k: v for k, v in CLAUDE_MESSAGE.items() if k not in ("content", "stop_reason", "usage")},
                "content": [],
                "stop_reason": None,
                "usage": {"input_tokens": 50, "cache_read_input_tokens": 0, "output_tokens": 1},
            },
        },
    ),
    (
        "content_block_start",
        {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
    ),
    (
        "content_block_delta",
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Ohm's "}},
    ),
    (
        "content_block_delta",
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "law"}},
    ),
    ("content_block_stop", {"type": "content_block_stop", "index": 0}),
    (
        "message_delta",
        {
            "type": "message_delta",
            "delta": {"stop_reason": "end_turn", "stop_sequence": None},
            "usage": {"output_tokens": 12},
        },
    ),
    ("message_stop", {"type": "message_stop"}),
]


def claude_batch(status: str) -> dict[str, Any]:
    return {
        "id": "msgbatch_01",
        "type": "message_batch",
        "processing_status": status,
        "request_counts": {"processing": 0, "succeeded": 1, "errored": 1, "canceled": 0, "expired": 1},
        "ended_at": "2026-10-28T10:00:00Z" if status == "ended" else None,
        "created_at": "2026-10-28T09:00:00Z",
        "expires_at": "2026-10-29T09:00:00Z",
        "archived_at": None,
        "cancel_initiated_at": None,
        "results_url": "https://api.anthropic.com/v1/messages/batches/msgbatch_01/results"
        if status == "ended"
        else None,
    }


CLAUDE_BATCH_RESULTS = [
    {"custom_id": "q-1", "result": {"type": "succeeded", "message": CLAUDE_MESSAGE}},
    {
        "custom_id": "q-2",
        "result": {
            "type": "errored",
            "error": {
                "type": "error",
                "error": {"type": "invalid_request_error", "message": "prompt is too long"},
            },
        },
    },
    {"custom_id": "q-3", "result": {"type": "expired"}},
]

CLAUDE_OVERLOADED = {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}
CLAUDE_BAD_REQUEST = {
    "type": "error",
    "error": {"type": "invalid_request_error", "message": "max_tokens: too large"},
}


def gpt_response(
    text: str = json.dumps(DRAFT),
    *,
    status: str = "completed",
    incomplete: str | None = None,
    refusal: bool = False,
) -> dict[str, Any]:
    part = (
        {"type": "refusal", "refusal": "I can't help with that."}
        if refusal
        else {"type": "output_text", "text": text, "annotations": []}
    )
    return {
        "id": "resp_01",
        "object": "response",
        "created_at": 1_761_600_000,
        "status": status,
        "model": "gpt-6-astra",
        "output": [
            {"type": "reasoning", "id": "rs_01", "summary": []},
            {
                "type": "message",
                "id": "msg_01",
                "status": "completed",
                "role": "assistant",
                "content": [part],
            },
        ],
        "usage": {
            "input_tokens": 5_000,
            "input_tokens_details": {"cached_tokens": 3_000, "cache_write_tokens": 1_000},
            "output_tokens": 800,
            "output_tokens_details": {"reasoning_tokens": 600},
            "total_tokens": 5_800,
        },
        "incomplete_details": {"reason": incomplete} if incomplete else None,
        "error": None,
        "instructions": None,
        "metadata": {},
        "parallel_tool_calls": True,
        "temperature": None,
        "tool_choice": "auto",
        "tools": [],
        "top_p": None,
    }


GPT_STREAM = [
    (
        "response.created",
        {"type": "response.created", "sequence_number": 0, "response": gpt_response(status="in_progress")},
    ),
    (
        "response.output_text.delta",
        {
            "type": "response.output_text.delta",
            "sequence_number": 1,
            "item_id": "msg_01",
            "output_index": 1,
            "content_index": 0,
            "delta": "Ohm's ",
            "logprobs": [],
        },
    ),
    (
        "response.output_text.delta",
        {
            "type": "response.output_text.delta",
            "sequence_number": 2,
            "item_id": "msg_01",
            "output_index": 1,
            "content_index": 0,
            "delta": "law",
            "logprobs": [],
        },
    ),
    (
        "response.completed",
        {"type": "response.completed", "sequence_number": 3, "response": gpt_response("Ohm's law")},
    ),
]

GPT_FILE = {
    "id": "file-in",
    "object": "file",
    "bytes": 100,
    "created_at": 1_761_600_000,
    "filename": "batch.jsonl",
    "purpose": "batch",
    "status": "processed",
}


def gpt_batch(status: str) -> dict[str, Any]:
    done = status == "completed"
    return {
        "id": "batch_01",
        "object": "batch",
        "endpoint": "/v1/responses",
        "input_file_id": "file-in",
        "completion_window": "24h",
        "status": status,
        "created_at": 1_761_600_000,
        "output_file_id": "file-out" if done else None,
        "error_file_id": "file-err" if done else None,
    }


GPT_BATCH_OUTPUT = [
    {
        "id": "batch_req_1",
        "custom_id": "q-1",
        "response": {"status_code": 200, "request_id": "req_1", "body": gpt_response()},
        "error": None,
    },
    {
        "id": "batch_req_2",
        "custom_id": "q-2",
        "response": {
            "status_code": 400,
            "request_id": "req_2",
            "body": {"error": {"message": "Invalid schema", "type": "invalid_request_error"}},
        },
        "error": None,
    },
]
GPT_BATCH_ERRORS = [
    {
        "id": "batch_req_3",
        "custom_id": "q-3",
        "response": None,
        "error": {"code": "timeout", "message": "expired"},
    }
]

GPT_RATE_LIMITED = {
    "error": {"message": "Rate limit reached", "type": "rate_limit_error", "code": "rate_limit_exceeded"}
}


def sse(events: list[tuple[str, dict[str, Any]]]) -> bytes:
    return "".join(f"event: {name}\ndata: {json.dumps(data)}\n\n" for name, data in events).encode()


def jsonl(rows: list[dict[str, Any]]) -> bytes:
    return "\n".join(json.dumps(row) for row in rows).encode()
