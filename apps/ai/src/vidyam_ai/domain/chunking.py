"""Splitting a document's text into retrieval chunks. Pure functions; no I/O.

Chunks follow the text's own structure: a question stays together with its options, paragraphs are not cut
mid-way unless one alone is too long, and a chunk records the pages it spans so answers can cite them.
"""

import math
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Literal

from vidyam_ai.domain.devanagari import script_mix

Language = Literal["hi", "en", "mixed"]

TARGET_TOKENS = 450  # a chunk closes once it reaches this size...
MAX_TOKENS = 800  # ...and never grows past this (a longer block is split at sentence ends)


@dataclass(frozen=True)
class PageText:
    page_no: int | None  # None for formats without pages (Word, plain text)
    text: str


@dataclass(frozen=True)
class Chunk:
    text: str
    page_start: int | None
    page_end: int | None
    language: Language
    token_count: int


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
_SENTENCE_END = re.compile(r"(?<=[।?!.])\s+")


@dataclass
class _Block:
    lines: list[str]
    page_no: int | None

    @property
    def text(self) -> str:
        return "\n".join(self.lines)


def _blocks(pages: Iterable[PageText]) -> list[_Block]:
    """Paragraphs and questions-with-options, in reading order."""
    blocks: list[_Block] = []
    current: _Block | None = None
    for page in pages:
        for line in page.text.split("\n"):
            if not line.strip():
                current = None
                continue
            starts_question = bool(_QUESTION_START.match(line)) and not _OPTION.match(line)
            if current is None or starts_question or current.page_no != page.page_no:
                current = _Block([line], page.page_no)
                blocks.append(current)
            else:
                current.lines.append(line)
    return blocks


def _split_long(block: _Block) -> list[_Block]:
    if estimate_tokens(block.text) <= MAX_TOKENS:
        return [block]
    parts: list[_Block] = []
    piece: list[str] = []
    for sentence in _SENTENCE_END.split(block.text):
        if piece and estimate_tokens(" ".join([*piece, sentence])) > MAX_TOKENS:
            parts.append(_Block([" ".join(piece)], block.page_no))
            piece = []
        piece.append(sentence)
    if piece:
        parts.append(_Block([" ".join(piece)], block.page_no))
    return parts


def chunk_pages(pages: Sequence[PageText]) -> list[Chunk]:
    """Pack consecutive blocks into chunks of about TARGET_TOKENS, never more than MAX_TOKENS."""
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
            )
        )
        group.clear()

    for block in (part for b in _blocks(pages) for part in _split_long(b)):
        size = sum(estimate_tokens(b.text) for b in group)
        if group and size + estimate_tokens(block.text) > MAX_TOKENS:
            close()
        group.append(block)
        if sum(estimate_tokens(b.text) for b in group) >= TARGET_TOKENS:
            close()
    close()
    return chunks
