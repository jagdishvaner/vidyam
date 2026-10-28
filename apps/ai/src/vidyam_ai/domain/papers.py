"""Question papers and their answer keys (plan v3 §5, step 6). Pure functions; no I/O.

A paper is split into questions by a model, a few pages per request (`windows`), because a 150-question
bilingual paper is longer than one reply can be. Answer keys are short and regular ("1. C  2. D", "Q.3 (B)",
"4-क", tables), so they are read by rules, with no model at all.

`rule_split` splits a paper by its printed numbering. It is how the stub model answers the segment task, and a
baseline for checking what a real model returns.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal

from vidyam_ai.domain.devanagari import script_mix

WINDOW_PAGES = 4  # pages per request: about 20 questions, well within one reply
MIN_KEY_COVERAGE = 0.8  # a key must answer at least this share of the numbers up to its highest one

_PAGE_MARK = re.compile(r"^=== page (\d+) ===$")
_HINDI_KEYS = {"क": "A", "ख": "B", "ग": "C", "घ": "D"}
# "12. C", "12) (c)", "Q.12 - C", "12-क", "| 12 | C |"
_KEY_PAIR = re.compile(
    r"(?<![\w.])(?:Q\.?\s*)?(\d{1,3})\s*[.):|–-]?\s*\|?\s*\(?\s*([A-Da-dक-घ])\s*\)?(?![\wऀ-ॿ])"
)


@dataclass(frozen=True)
class PaperPage:
    page_no: int
    text: str


@dataclass(frozen=True)
class Window:
    first_page: int
    last_page: int
    text: str  # the window's pages, then the next one for context, each under "=== page N ==="


def windows(pages: Sequence[PaperPage], size: int = WINDOW_PAGES) -> list[Window]:
    result: list[Window] = []
    for start in range(0, len(pages), size):
        own = pages[start : start + size]
        shown = [*own, *pages[start + size : start + size + 1]]
        text = "\n\n".join(f"=== page {page.page_no} ===\n{page.text}" for page in shown)
        result.append(Window(own[0].page_no, own[-1].page_no, text))
    return result


def parse_answer_key(text: str) -> dict[int, str]:
    """Question number → option key (A–D). Empty when the text doesn't look like a complete key."""
    found: dict[int, str] = {}
    for match in _KEY_PAIR.finditer(text):
        number, key = int(match.group(1)), match.group(2)
        found.setdefault(number, _HINDI_KEYS.get(key, key.upper()))
    if len(found) < 5 or len(found) < max(found) * MIN_KEY_COVERAGE:
        return {}
    return dict(sorted(found.items()))


# --- Splitting by printed numbering -------------------------------------------------------------------------

Lang = Literal["hi", "en"]
_QUESTION = re.compile(r"^\s*(?:Q\.?\s*|प्रश्न\s*)?(\d{1,3})\s*[.)]\s+(.*)$")
_OPTION = re.compile(r"^\s*\(\s*([A-Da-dक-घ])\s*\)\s*(.*)$")


def _lang(text: str) -> Lang:
    """A line with Hindi words in it is the Hindi version, even when formulas and abbreviations in Latin
    letters outnumber them ("CH₃CH₂CH₂OH का IUPAC नाम है")."""
    hindi, _ = script_mix(text)
    return "hi" if hindi >= 3 else "en"


@dataclass
class DraftQuestion:
    number: int
    page: int
    stem: dict[Lang, list[str]] = field(default_factory=lambda: {"hi": [], "en": []})
    options: dict[Lang, list[tuple[str, str]]] = field(default_factory=lambda: {"hi": [], "en": []})

    def qtype(self) -> str:
        stem = " ".join(self.stem["en"] + self.stem["hi"]).lower()
        if "assertion" in stem or "कथन (a)" in stem:
            return "assertion_reason"
        if "statement" in stem or "कथनों" in stem:
            return "statement"
        if self.options["en"] or self.options["hi"]:
            return "mcq_single"
        return "short_answer"

    def text(self, lang: Lang) -> dict[str, object] | None:
        if not self.stem[lang]:
            return None
        options = [{"key": key, "text": text} for key, text in self.options[lang]]
        return {"stem": " ".join(self.stem[lang]), "options": options, "solution": None}


def _add_option(question: DraftQuestion, key: str, text: str) -> None:
    key = _HINDI_KEYS.get(key, key.upper())
    parts = [part.strip() for part in text.split(" / ")]
    if len(parts) == 2 and _lang(parts[0]) != _lang(parts[1]):
        for part in parts:
            question.options[_lang(part)].append((key, part))
        return
    for lang in ("hi", "en"):  # numbers and symbols read the same in both languages
        question.options[lang].append((key, parts[0] if len(parts) == 2 else text.strip()))


def rule_split(text: str, first_page: int, last_page: int) -> list[DraftQuestion]:
    """Questions starting on pages first_page..last_page of a window's text. A numbered line starts a question
    only when it continues the numbering, so statements numbered 1, 2, 3 inside a stem stay in it."""
    questions: list[DraftQuestion] = []
    page = first_page
    current: DraftQuestion | None = None
    for line in text.split("\n"):
        line = line.strip().lstrip("#").strip()
        if not line:
            continue
        mark = _PAGE_MARK.match(line)
        if mark:
            page = int(mark.group(1))
            continue
        start = _QUESTION.match(line)
        if start and (current is None or int(start.group(1)) == current.number + 1):
            current = DraftQuestion(int(start.group(1)), page)
            questions.append(current)
            line = start.group(2)
        if current is None:
            continue  # instructions before the first question
        option = _OPTION.match(line)
        lang = _lang(line)
        if option:
            _add_option(current, option.group(1), option.group(2))
        elif current.options[lang]:  # an option wrapped onto the next line
            key, text = current.options[lang][-1]
            current.options[lang][-1] = (key, f"{text} {line}")
        else:
            current.stem[lang].append(line)
    return [q for q in questions if first_page <= q.page <= last_page]
