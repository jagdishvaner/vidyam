"""The stub model (plan v3 §8): answers every task in character, quickly and for free, so the whole platform
runs end to end before any provider key exists. The same call always gets the same answer. Replies that need
structure follow the requested JSON Schema; tasks with their own responder answer like the real model would.

Batches finish at once; their results are kept in files so a restarted worker can still collect them.
"""

import asyncio
import json
import math
import re
import uuid
from collections.abc import AsyncIterator, Callable, Sequence
from dataclasses import asdict
from pathlib import Path

from vidyam_ai.application.llm_gateway import BatchStatus, ProviderError
from vidyam_ai.domain.llm import BatchResult, Completion, ModelCall, Usage
from vidyam_ai.infrastructure.llm.schemas import example

type Responder = Callable[[ModelCall], str]

_WORD = re.compile(r"\S+")


def _tokens(text: str) -> int:
    """Roughly what a real tokenizer would count, so stub ledger rows look plausible."""
    return max(1, math.ceil(len(text) / 4))


def _last_user_text(call: ModelCall) -> str:
    return next((turn.text for turn in reversed(call.turns) if turn.role == "user"), "")


def _chat_title(call: ModelCall) -> str:
    words = _WORD.findall(call.variables.get("first_message", ""))
    hindi = call.variables.get("language", "").strip().lower() in ("hindi", "hi", "हिन्दी", "हिंदी")
    if sum(len(word) for word in words) < 4:
        return "नई चैट" if hindi else "New chat"
    return " ".join(words[:6]).rstrip(".!?।,;:")


def _generic(call: ModelCall) -> str:
    asked = " ".join(_WORD.findall(_last_user_text(call))[:40])
    return (
        f"[Stub answer for {call.task or 'this task'}] Vidyam's built-in test model replied, because no AI "
        f"provider key is set. Real answers start once one is added.\n\n> {asked}"
    )


RESPONDERS: dict[str, Responder] = {"chat_title": _chat_title}


def answer(call: ModelCall) -> Completion:
    if call.output:
        text = json.dumps(example(call.output.schema, seed=call.task), ensure_ascii=False)
    else:
        text = RESPONDERS.get(call.task, _generic)(call)
    prompt = "\n".join([*(segment.text for segment in call.system), *(turn.text for turn in call.turns)])
    usage = Usage(input_tokens=_tokens(prompt), output_tokens=_tokens(text))
    return Completion(text, usage, "done", "stub", None)


class StubProvider:
    def __init__(self, batch_dir: Path, *, delay_s: float = 0.015) -> None:
        """`delay_s`: the pause between streamed words, so streaming looks and behaves like a real model."""
        self._batch_dir = batch_dir
        self._delay_s = delay_s

    async def complete(self, call: ModelCall) -> Completion:
        return answer(call)

    async def stream(self, call: ModelCall) -> AsyncIterator[str | Completion]:
        done = answer(call)
        for piece in re.findall(r"\S+\s*|\s+", done.text):
            await asyncio.sleep(self._delay_s)
            yield piece
        yield done

    async def submit_batch(self, calls: Sequence[tuple[str, ModelCall]]) -> str:
        batch_id = f"stub_{uuid.uuid4().hex}"
        results = [{"custom_id": cid, **asdict(answer(call))} for cid, call in calls]
        self._batch_dir.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(self._path(batch_id).write_text, json.dumps(results, ensure_ascii=False))
        return batch_id

    async def batch_status(self, batch_id: str) -> BatchStatus:
        if not self._path(batch_id).exists():
            raise ProviderError(
                f"stub batch {batch_id} is gone (its results file was removed)", retryable=False
            )
        return "ended"

    async def batch_results(self, batch_id: str) -> Sequence[BatchResult]:
        await self.batch_status(batch_id)
        rows = json.loads(await asyncio.to_thread(self._path(batch_id).read_text))
        return [
            BatchResult(
                row["custom_id"],
                Completion(row["text"], Usage(**row["usage"]), row["finish"], row["stop_reason"], None),
            )
            for row in rows
        ]

    def _path(self, batch_id: str) -> Path:
        return self._batch_dir / f"{batch_id}.json"
