"""The stub model (plan v3 §8): answers every task in character, quickly and for free, so the whole platform
runs end to end before any provider key exists. The same call always gets the same answer. Replies that need
structure follow the requested JSON Schema; tasks with their own responder answer like the real model would.

Batches finish at once; their results are kept in files so a restarted worker can still collect them.
"""

import asyncio
import hashlib
import json
import math
import re
import uuid
from collections.abc import AsyncIterator, Callable, Sequence
from dataclasses import asdict
from pathlib import Path

from vidyam_ai.application.llm_gateway import BatchStatus, ProviderError
from vidyam_ai.domain.devanagari import script_mix
from vidyam_ai.domain.generation import OPTION_TYPES as _OPTION_TYPES
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


def _passages(call: ModelCall) -> list[tuple[int, str]]:
    """The numbered passages in the system prompt, each as one line of text (its heading line dropped)."""
    out: list[tuple[int, str]] = []
    for segment in call.system:
        for match in _PASSAGE.finditer(segment.text):
            lines = [line for line in match.group(2).split("\n") if line.strip()]
            out.append(
                (int(match.group(1)), " ".join(" ".join(lines[1:] if len(lines) > 1 else lines).split()))
            )
    return out


def _hindi(text: str) -> bool:
    hindi, latin = script_mix(text)
    return hindi > latin


def _balanced(text: str) -> bool:
    return text.count("$") % 2 == 0 and text.count("{") == text.count("}")


_TOKEN = re.compile(r"[^\s.,;:!?।()\[\]\"'\u201c\u201d\u2018\u2019/\-\u2013\u2014$\\{}]{3,}")
_NUMBER = re.compile(r"(?<![\w.])\d+(?:\.\d+)?(?![\w.])")
_SLOT = re.compile(r'slot "([^"]+)": .*?\((\w+)\), difficulty (\d)')
_BLANK = "____"
_PROMPTS = {
    "option": ("Fill in the blank: ", "रिक्त स्थान भरिए: "),
    "number": ("Fill in the number: ", "संख्या भरिए: "),
    "text": ("Explain, in your own words: ", "अपने शब्दों में समझाइए: "),
}


def _terms(text: str) -> list[str]:
    """Words a blank can stand for: no digits, no mathematics."""
    return [word for word in _TOKEN.findall(text) if not any(char.isdigit() for char in word)]


def _cloze(sentence: str, kind: str) -> tuple[str, str] | None:
    """The sentence with its longest word (or its first number) blanked out, and what was blanked."""
    if kind == "number":
        found = _NUMBER.search(sentence)
        return (
            (sentence[: found.start()] + _BLANK + sentence[found.end() :], found.group()) if found else None
        )
    words = _terms(sentence)
    if not words:
        return None
    word = max(words, key=len)
    return sentence.replace(word, _BLANK, 1), word


def _generate(call: ModelCall) -> str:
    """Fill-in-the-blank questions from the evidence, one per slot, the way a careful script would: a word of
    a passage's sentence blanked out, with words from other sentences as the wrong options (a number, for
    numeric slots). The stub can't translate: with Hindi asked for, Hindi passages are used first."""
    asked = _last_user_text(call)
    languages = [
        lang
        for lang, name in (("hi", "Hindi"), ("en", "English"))
        if name in asked.split("Languages:")[-1].split("\n")[0]
    ]
    passages = _passages(call)
    if "hi" in languages:
        passages.sort(key=lambda p: not _hindi(p[1]))  # Hindi passages first, in their order
    pool = list(dict.fromkeys(word for _, text in passages for word in _terms(text)))
    questions: list[dict[str, object]] = []
    for i, (slot, qtype, _difficulty) in enumerate(_SLOT.findall(asked)):
        kind = (
            "option" if qtype in _OPTION_TYPES else "number" if qtype in ("numerical", "integer") else "text"
        )
        made = None
        for n, text in passages[i % max(1, len(passages)) :] + passages[: i % max(1, len(passages))]:
            for sentence in _SENTENCE.split(text):
                if len(sentence) > 300 or not _balanced(sentence):
                    continue
                blanked = _cloze(sentence, kind) if kind != "text" else (sentence, sentence)
                if blanked:
                    made = (n, sentence, *blanked)
                    break
            if made:
                break
        if made is None:
            questions.append({"slot": slot, "hi": None, "en": None, "correct": [], "value": None,
                              "model_answer": None, "cites": []})  # fmt: skip
            continue
        n, sentence, stem, filled = made
        keys, correct = ["A", "B", "C", "D"], None
        options: list[dict[str, str]] = []
        if kind == "option":
            wrong = [word for word in pool if word != filled][i * 3 : i * 3 + 3] or [
                w for w in pool if w != filled
            ][:3]
            correct = keys[int(hashlib.sha256(slot.encode()).hexdigest(), 16) % (len(wrong) + 1)]
            texts = iter(wrong)
            options = [
                {"key": key, "text": filled if key == correct else next(texts)}
                for key in keys[: len(wrong) + 1]
            ]
        shown = stem if kind != "text" else " ".join(_WORD.findall(sentence)[:8]) + " …"
        versions = {
            lang: {"stem": prompt + shown, "options": options, "solution": f"{label} {sentence}"}
            for lang, prompt, label in (
                ("en", _PROMPTS[kind][0], "From your material:"),
                ("hi", _PROMPTS[kind][1], "आपकी सामग्री के अनुसार:"),
            )
        }
        questions.append(
            {
                "slot": slot,
                "hi": versions["hi"] if "hi" in languages else None,
                "en": versions["en"] if "en" in languages else None,
                "correct": [correct] if correct else [],
                "value": float(filled) if kind == "number" else None,
                "model_answer": sentence if kind == "text" else None,
                "cites": [n],
            }
        )
    return json.dumps({"questions": questions}, ensure_ascii=False)


_ITEM = re.compile(r'<item id="([^"]+)">(.*?)</item>', re.DOTALL)


def _verify_grounding(call: ModelCall) -> str:
    """Supported when a question cites a passage; notes always are. The stub can't judge meaning."""
    verdicts = []
    for item, body in _ITEM.findall(call.variables.get("items", "")):
        cites = re.search(r"Cites passages: (\d)", body) if "Cites passages:" in body else True
        verdicts.append(
            {"item": item, "supported": bool(cites), "problem": None if cites else "cites nothing"}
        )
    return json.dumps({"verdicts": verdicts}, ensure_ascii=False)


def _verify_solve(call: ModelCall) -> str:
    """Solves a fill-in-the-blank question by finding its sentence in the passages."""
    question = call.variables.get("question", "")
    stem = next(
        (line.removeprefix("Question: ") for line in question.split("\n") if line.startswith("Question: ")),
        "",
    )
    options = dict(re.findall(r"^([A-Z])\) (.*)$", question, re.MULTILINE))
    rest = stem.split(": ", 1)[-1]
    keys: list[str] = []
    value: float | None = None
    if _BLANK in rest:
        # The blank stands for one word or number.
        pattern = re.compile(re.escape(" ".join(rest.split())).replace(_BLANK, r"(\S+)", 1))
        for segment in call.system:
            found = pattern.search(" ".join(segment.text.split()))
            if found:
                filled = found.group(1)
                keys = [key for key, option in options.items() if option.strip() == filled.strip()]
                value = float(filled) if _NUMBER.fullmatch(filled.strip()) else None
                break
    working = "Found the sentence in the material." if keys or value is not None else "Couldn't find it."
    return json.dumps({"keys": keys, "value": value, "working": working}, ensure_ascii=False)


def _notes_write(call: ModelCall) -> str:
    """Notes made of the passages' first sentences, each citing its passage."""
    asked = _last_user_text(call)
    topic = next(
        (line.removeprefix("Topic: ") for line in asked.split("\n") if line.startswith("Topic: ")), ""
    )
    passages = _passages(call)[:4]
    wanted = asked.split("Languages:")[-1].split("\n")[0]
    bodies: dict[str, str | None] = {"hi": None, "en": None}
    for lang, name in (("hi", "Hindi"), ("en", "English")):
        if name not in wanted:
            continue
        mine = sorted(passages, key=lambda p: _hindi(p[1]) != (lang == "hi"))
        points = [f"- {' '.join(_SENTENCE.split(text)[:2])} [{n}]" for n, text in mine]
        heading = "मुख्य बिंदु" if lang == "hi" else "Key points"
        stub = "[Stub notes until an AI key is added]"
        bodies[lang] = f"{stub}\n\n### {topic}\n\n#### {heading}\n\n" + "\n".join(points)
    return json.dumps({**bodies, "cites": [n for n, _ in passages]}, ensure_ascii=False)


RESPONDERS: dict[str, Responder] = {
    "chat_title": _chat_title,
    "chat_qa": _chat_qa,
    "generate": _generate,
    "verify_grounding": _verify_grounding,
    "verify_solve": _verify_solve,
    "notes_write": _notes_write,
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
