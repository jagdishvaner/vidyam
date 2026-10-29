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
from vidyam_ai.domain.papers import rule_split
from vidyam_ai.domain.sections import match_tokens
from vidyam_ai.infrastructure.llm.schemas import example

type Responder = Callable[[ModelCall], str]

_WORD = re.compile(r"\S+")
IMAGE_TOKENS = 1_600  # what a page image costs a real model; the stub can't look at it


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


def _ocr(call: ModelCall) -> str:
    """The stub can't see images. It says so, legibility 0, and the page stays in the OCR backlog."""
    page = call.variables.get("page", "?")
    title = call.variables.get("file_title", "this file")
    note = (
        f"[Stub reading of page {page} of {title}: the built-in test model can't see images. A vision "
        "model reads this page once an AI provider key is set.]"
    )
    return json.dumps({"markdown": note, "hasFigures": False, "legibility": 0}, ensure_ascii=False)


def _segment(call: ModelCall) -> str:
    """Splits by the printed numbering, the way a careful script would."""
    first, last = int(call.variables.get("first_page", "1")), int(call.variables.get("last_page", "1"))
    questions = [
        {
            "number": q.number,
            "qtype": q.qtype(),
            "hi": q.text("hi"),
            "en": q.text("en"),
            "page": q.page,
            "hasFigure": False,
        }
        for q in rule_split(call.variables.get("text", ""), first, last)
        if q.text("hi") or q.text("en")
    ]
    return json.dumps({"questions": questions}, ensure_ascii=False)


def _tag(call: ModelCall) -> str:
    """Picks the candidate whose names share the most words with the text, the deepest on a tie."""
    text = f"{call.variables.get('heading_path', '')}\n{call.variables.get('text', '')}"
    best: tuple[float, int, str] | None = None
    for segment in call.system:
        for line in segment.text.split("\n")[1:]:
            path, *names = (part.strip() for part in line.split(" | "))
            names = [name for part in names for name in part.split(", ") if name]
            score = max((match_tokens(name, text) for name in names), default=0.0)
            key = (score, path.count("/"), path)
            if score > 0 and (best is None or key > best):
                best = key
    tags = [{"node": best[2], "confidence": round(min(0.95, 0.5 + best[0] / 2), 2)}] if best else []
    return json.dumps({"tags": tags}, ensure_ascii=False)


_KINDS = [
    ("revision_sheet", r"revision|quick notes|short notes|पुनरावृत्ति"),
    ("worksheet", r"worksheet|practice set|\bdpp\b|अभ्यास"),
    ("notes", r"\bnotes\b|नोट्स"),
    ("question_paper", r"\bpaper\b|\btest\b|\bmock\b|प्रश्न-?\s?पत्र|पेपर|टेस्ट"),
]
_MAKE = r"\b(banao|bana do|banaiye|make|create|generate|prepare)\b|बनाओ|बनाइए|बना दो|तैयार"
_ASK = r"\?|\b(what|why|how|explain|kya|kyon|kyu|kaise|define)\b|समझाइए|क्या|क्यों|कैसे"
_AFTER = re.compile(r"\b(?:on|about|chapter)\s+(.+)$", re.IGNORECASE)  # "a paper on motion"
_BEFORE = re.compile(r"^(.*?)\s+(?:par|pe|पर)\b", re.IGNORECASE)  # "gati par paper", "प्रकाश पर नोट्स"
_AND = re.compile(r"\s*(?:,|\band\b|\baur\b|और|तथा)\s*", re.IGNORECASE)
_NOT_A_TOPIC = re.compile(r"\d|easy|hard|medium|आसान|कठिन|hindi|english|हिंदी", re.IGNORECASE)


def _topics(text: str) -> list[str]:
    found = _AFTER.search(text) or _BEFORE.search(text)
    parts = _AND.split(found.group(1)) if found else []
    return [part.strip(" .?!।") for part in parts if part.strip(" .?!।") and not _NOT_A_TOPIC.search(part)]


def _words(text: str) -> frozenset[str]:
    return frozenset(re.findall(r"[^\W_]+", text.casefold())) - {
        "on",
        "of",
        "and",
        "par",
        "ka",
        "ki",
        "ke",
        "the",
    }


def _spec(call: ModelCall) -> str:
    """Reads the message the way a careful script would: keywords for the intent and kind, the exam whose name
    the message shares most words with, and the names after "on" / "par" / "पर" as topics."""
    text = _last_user_text(call)
    low = text.casefold()
    kind = next((kind for kind, pattern in _KINDS if re.search(pattern, low)), None)
    asks = bool(re.search(_ASK, low))
    intent = "create" if kind or re.search(_MAKE, low) else "ask" if asks else "chat"
    # The exam whose name shares most words with the message, both ways (Dice), so a short name doesn't win
    # on a couple of common words.
    said = _words(text)
    exams: list[tuple[float, str]] = []
    for line in call.variables.get("exams", "").split("\n"):
        code, *names = (part.strip() for part in line.split("|"))
        overlap = [2 * len(said & _words(name)) / (len(said) + len(_words(name))) for name in names if name]
        exams.append((max(overlap, default=0.0), code))
    exams.sort(reverse=True)
    exam = (
        exams[0][1]
        if exams and exams[0][0] >= 0.3 and (len(exams) < 2 or exams[0][0] > exams[1][0])
        else None
    )
    topics = _topics(text) if intent == "create" else []
    count = re.search(r"(\d+)\s*(?:questions?|q\b|प्रश्न|sawal|सवाल|mcqs?)", low)
    minutes = re.search(r"(\d+)\s*(?:min|minutes|मिनट)", low)
    difficulty = next(
        (level for level, pattern in [("easy", r"easy|आसान|saral"), ("hard", r"hard|tough|कठिन|kathin"),
                                      ("medium", r"medium|मध्यम")] if re.search(pattern, low)),
        None,
    )  # fmt: skip
    languages = (
        ["hi"] if re.search(r"hindi only|only hindi|केवल हिंदी|sirf hindi", low)
        else ["en"] if re.search(r"english only|only english|केवल अंग्रेज़ी|sirf english", low)
        else ["hi", "en"] if re.search(r"bilingual|dono|दोनों", low)
        else []
    )  # fmt: skip
    understood: dict[str, object] = {
        "intent": intent,
        "kind": kind,
        "exam_code": exam,
        "topics": topics,
        "question_count": int(count.group(1)) if count else None,
        "question_types": ["mcq_single"] if "mcq" in low else [],
        "difficulty": difficulty,
        "languages": languages,
        "duration_minutes": int(minutes.group(1)) if minutes else None,
        "sourcing": "fresh_only" if re.search(r"fresh|new questions|नए प्रश्न", low) else None,
        "title": None,
        "question": text if intent == "ask" else None,
    }
    return json.dumps(understood, ensure_ascii=False)


_PASSAGE = re.compile(r'<passage n="(\d+)"[^>]*>\n(.*?)\n</passage>', re.DOTALL)
_SENTENCE = re.compile(r"(?<=[.?!।])\s+")


def _chat_qa(call: ModelCall) -> str:
    """With passages, answers from the first one and cites it, as the real model is asked to; without, says
    what the stub is."""
    passages = [match for segment in call.system for match in _PASSAGE.finditer(segment.text)]
    if not passages:
        return _generic(call)
    number, body = passages[0].group(1), passages[0].group(2)
    lines = [line for line in body.split("\n") if line.strip()]
    text = " ".join(lines[1:] if len(lines) > 1 else lines)
    answer = " ".join(_SENTENCE.split(" ".join(text.split()))[:2])
    return f"[Stub answer from your material, until an AI key is added] {answer} [{number}]"


RESPONDERS: dict[str, Responder] = {
    "chat_title": _chat_title,
    "chat_qa": _chat_qa,
    "ocr_text": _ocr,
    "segment": _segment,
    "spec": _spec,
    "tag": _tag,
}


def answer(call: ModelCall) -> Completion:
    responder = RESPONDERS.get(call.task)
    if responder:
        text = responder(call)
    elif call.output:
        text = json.dumps(example(call.output.schema, seed=call.task), ensure_ascii=False)
    else:
        text = _generic(call)
    prompt = "\n".join([*(segment.text for segment in call.system), *(turn.text for turn in call.turns)])
    images = sum(len(turn.images) for turn in call.turns)
    usage = Usage(input_tokens=_tokens(prompt) + images * IMAGE_TOKENS, output_tokens=_tokens(text))
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
