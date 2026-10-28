"""Splitting a document's text into retrieval chunks. Pure functions; no I/O.

Chunks follow the text's own structure:
- a chunk never spans two headings, and records the headings above it (its heading path: "अध्याय 8: गति ›
  त्वरण"), which is embedded with it as context;
- a question stays together with its options, and questions are never packed with explanatory text;
- paragraphs are not cut mid-way unless one alone is too long;
- a chunk records the pages it spans, so answers can cite them, and what kind of text it is.
"""

import math
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Literal

from vidyam_ai.domain.devanagari import script_mix
from vidyam_ai.domain.headings import parse_heading

Language = Literal["hi", "en", "mixed"]
ChunkKind = Literal["prose", "question", "solution", "definition", "table"]

CHUNKER_VERSION = "chunker-2"  # bump whenever chunk boundaries or texts change
TARGET_TOKENS = 450  # a chunk closes once it reaches this size...
MAX_TOKENS = 800  # ...and never grows past this (a longer block is split at sentence ends)
HEADING_SEPARATOR = " › "


@dataclass(frozen=True)
class PageText:
    page_no: int | None  # None for formats without pages (Word, plain text)
    text: str  # Markdown: headings are #, ## and ### lines


@dataclass(frozen=True)
class Chunk:
    text: str
    page_start: int | None
    page_end: int | None
    language: Language
    token_count: int
    heading_path: tuple[str, ...] = ()
    kind: ChunkKind = "prose"


def estimate_tokens(text: str) -> int:
    """Approximate embedding-model tokens: Devanagari packs fewer characters per token than Latin script.
    The exact count comes from the embedding model's tokenizer at indexing time."""
    hindi, _ = script_mix(text)
    other = len(re.sub(r"\s", "", text)) - hindi
    return max(1, math.ceil(hindi / 2.5 + other / 4))


def detect_language(text: str) -> Language:
    hindi, latin = script_mix(text)
    if hindi + latin == 0:
        return "en"
    share = hindi / (hindi + latin)
    return "hi" if share >= 0.8 else "en" if share <= 0.2 else "mixed"


# "1.", "12)", "Q.5", "Q 5", "प्रश्न 3", "प्र.3" start a new question...
_QUESTION_START = re.compile(r"^\s*(?:(?:Q|Que|Ques|प्रश्न|प्र)\s*[.:]?\s*\d+|\d{1,3}\s*[.)])\s*\S")
# ...and "(A)", "a)", "B.", "(1)", "(क)", "क)" are options that stay with it.
_OPTION = re.compile(r"^\s*(?:\(\s*[A-Da-d1-4क-घ]\s*\)|[A-Da-dक-घ]\s*[.)])\s*\S")
_SOLUTION = re.compile(r"^\s*(?:solution|sol|answer|ans|explanation|हल|उत्तर|व्याख्या)\s*[.:)–-]", re.IGNORECASE)
_DEFINITION = re.compile(
    r"^\s*(?:परिभाषा|definition)\b|is defined as|is called|is known as|कहते हैं|कहलाता है|कहलाती है",
    re.IGNORECASE,
)
_SENTENCE_END = re.compile(r"(?<=[।?!.])\s+")


@dataclass
class _Block:
    lines: list[str]
    page_no: int | None
    heading_path: tuple[str, ...] = ()
    kind: ChunkKind = "prose"

    @property
    def text(self) -> str:
        return "\n".join(self.lines)

    @property
    def family(self) -> str:
        return "question" if self.kind in ("question", "solution") else "prose"


def _kind(first_line: str) -> ChunkKind:
    if _QUESTION_START.match(first_line) and not _OPTION.match(first_line):
        return "question"
    if _SOLUTION.match(first_line):
        return "solution"
    if first_line.lstrip().startswith("|"):
        return "table"
    first_sentence = _SENTENCE_END.split(first_line, maxsplit=1)[0]
    return "definition" if _DEFINITION.search(first_sentence) else "prose"


def _blocks(pages: Iterable[PageText]) -> list[_Block]:
    """Paragraphs and questions-with-options, in reading order, each under the headings above it."""
    blocks: list[_Block] = []
    current: _Block | None = None
    path: tuple[str, ...] = ()
    for page in pages:
        for line in page.text.split("\n"):
            heading = parse_heading(line)
            if heading:
                path = (*path[: heading.level - 1], heading.text)
                current = None
                continue
            if not line.strip():
                current = None
                continue
            kind = _kind(line)
            starts = kind in ("question", "solution") or (kind == "table") != (
                current is not None and current.kind == "table"
            )
            if current is None or starts or current.page_no != page.page_no:
                current = _Block([line], page.page_no, path, kind)
                blocks.append(current)
            else:
                current.lines.append(line)
    return blocks


def _split_long(block: _Block) -> list[_Block]:
    if estimate_tokens(block.text) <= MAX_TOKENS:
        return [block]
    parts: list[_Block] = []
    piece: list[str] = []

    def add(text: str) -> None:
        parts.append(_Block([text], block.page_no, block.heading_path, block.kind))

    for sentence in _SENTENCE_END.split(block.text):
        if piece and estimate_tokens(" ".join([*piece, sentence])) > MAX_TOKENS:
            add(" ".join(piece))
            piece = []
        piece.append(sentence)
    if piece:
        add(" ".join(piece))
    return parts


def _chunk_kind(group: Sequence[_Block]) -> ChunkKind:
    kinds = {block.kind for block in group}
    if group[0].family == "question":
        return "solution" if kinds == {"solution"} else "question"
    if kinds == {"table"}:
        return "table"
    return "definition" if group[0].kind == "definition" else "prose"


def chunk_pages(pages: Sequence[PageText]) -> list[Chunk]:
    """Pack consecutive blocks under the same headings, and of the same family (questions, or explanatory
    text), into chunks of about TARGET_TOKENS, never more than MAX_TOKENS."""
    chunks: list[Chunk] = []
    group: list[_Block] = []

    def close() -> None:
        if not group:
            return
        text = "\n\n".join(b.text for b in group)
        numbers = [b.page_no for b in group if b.page_no is not None]
        chunks.append(
            Chunk(
                text=text,
                page_start=min(numbers) if numbers else None,
                page_end=max(numbers) if numbers else None,
                language=detect_language(text),
                token_count=estimate_tokens(text),
                heading_path=group[0].heading_path,
                kind=_chunk_kind(group),
            )
        )
        group.clear()

    for block in (part for b in _blocks(pages) for part in _split_long(b)):
        size = sum(estimate_tokens(b.text) for b in group)
        if group and (
            size + estimate_tokens(block.text) > MAX_TOKENS
            or block.heading_path != group[0].heading_path
            or block.family != group[0].family
        ):
            close()
        group.append(block)
        if sum(estimate_tokens(b.text) for b in group) >= TARGET_TOKENS:
            close()
    close()
    return chunks


def context_header(title: str | None, heading_path: Sequence[str]) -> str | None:
    """What a chunk is about, from where it sits in its file ("कार्य और ऊर्जा — नोट्स › स्थितिज ऊर्जा"). It is
    embedded together with the chunk's text, at no cost (no LLM call)."""
    parts = [part for part in (title, *heading_path) if part]
    # A file's first heading often repeats its title.
    if len(parts) > 1 and parts[0].casefold() == parts[1].casefold():
        parts = parts[1:]
    return HEADING_SEPARATOR.join(parts) or None
