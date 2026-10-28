"""Finding a document's headings, and writing them into its pages as Markdown. Pure functions; no I/O.

PDFs say nothing about structure, only how text looks. A heading is a short line set noticeably larger than
the body text, or entirely bold, or one that starts like a chapter ("अध्याय 8", "Chapter 3", "इकाई 2"). Word
files name their heading styles and Markdown files mark them with #. In the stored page text headings become
`#`, `##` and `###` lines, which the chunker reads to give every chunk its heading path (plan v3 §5).
"""

import re
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass

from vidyam_ai.domain.devanagari import clean_text
from vidyam_ai.domain.documents import Heading, TextRun

MAX_LEVEL = 3
MAX_HEADING_CHARS = 100
MAX_HEADING_WORDS = 14
BIGGER = 1.12  # a heading's text is at least this much larger than the body text
RUNNING_SHARE = 0.3  # a line on this share of pages (and at least 3) is a running header, not a heading

_CHAPTER_START = re.compile(
    r"^(?:अध्याय|पाठ|इकाई|खण्ड|खंड|भाग|chapter|unit|lesson|part)\s*[-–—:.]?\s*(?:\d+|[०-९]+|[ivxlc]+)\b",
    re.IGNORECASE,
)
# Lines that are never headings: page numbers, list items, questions and their options.
_PAGE_NUMBER = re.compile(
    r"^(?:(?i:page|पृष्ठ|set [a-d] ·)\s*)?(?:\d+|[०-९]+|[IVXLC]+|[ivxlc]{1,5})$|^[\d\s.·|/–-]+$"
)
_LIST_ITEM = re.compile(r"^(?:[•▪◦·*-]|\(?[\da-dक-घ]{1,3}[.)]|Q\s*\.?\s*\d+|प्र(?:श्न)?\s*\.?\s*\d+)\s", re.I)
_MARKDOWN = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")


@dataclass(frozen=True)
class StyledLine:
    text: str  # clean Unicode
    size: float | None  # the size most of its characters have
    bold: bool  # every visible character is bold


def styled_lines(runs: Sequence[TextRun]) -> list[StyledLine]:
    """A page's Unicode runs as lines, each with how its text looks."""
    lines: list[StyledLine] = []
    parts: list[str] = []
    sizes: Counter[float] = Counter()
    visible = bold = 0

    def close() -> None:
        nonlocal visible, bold
        text = clean_text("".join(parts))
        if text:
            size = sizes.most_common(1)[0][0] if sizes else None
            lines.append(StyledLine(text, size, visible > 0 and bold == visible))
        parts.clear()
        sizes.clear()
        visible = bold = 0

    for run in runs:
        for n, piece in enumerate(run.text.replace("\r\n", "\n").replace("\r", "\n").split("\n")):
            if n:
                close()
            count = len(re.sub(r"\s", "", piece))
            parts.append(piece)
            if count:
                visible += count
                bold += count if run.bold else 0
                if run.size:
                    sizes[round(run.size * 2) / 2] += count
    close()
    return lines


def _body_size(pages: Sequence[Sequence[StyledLine]]) -> float | None:
    sizes: Counter[float] = Counter()
    for line in (line for page in pages for line in page):
        if line.size:
            sizes[line.size] += len(line.text)
    return sizes.most_common(1)[0][0] if sizes else None


def _running_lines(pages: Sequence[Sequence[StyledLine]]) -> set[str]:
    seen = Counter(text for page in pages for text in {line.text for line in page})
    least = max(3, len(pages) * RUNNING_SHARE)
    return {text for text, count in seen.items() if count >= least}


def _could_be_heading(text: str) -> bool:
    words = len(text.split())
    if len(text) > MAX_HEADING_CHARS or words > MAX_HEADING_WORDS or _PAGE_NUMBER.match(text):
        return False
    # A heading is not a sentence: it doesn't end in a full stop (short "Introduction." aside).
    return not (text.endswith("।") or (text.endswith(".") and words > 4))


def find_headings(pages: Sequence[Sequence[StyledLine]]) -> list[tuple[Heading, ...]]:
    """Each page's headings, judged against the whole document: what counts as "larger" depends on the body
    text size, and a line repeated on many pages is a running header."""
    body = _body_size(pages)
    running = _running_lines(pages)
    found: list[list[tuple[str, float | None, str]]] = []  # per page: (text, size, why)
    for page in pages:
        candidates: list[tuple[str, float | None, str]] = []
        for line in page:
            text = line.text
            if text in running or not _could_be_heading(text):
                continue
            if body and line.size and line.size >= body * BIGGER:
                candidates.append((text, line.size, "size"))
            elif _CHAPTER_START.match(text):
                candidates.append((text, line.size, "chapter"))
            elif line.bold and len(text.split()) <= 10 and not _LIST_ITEM.match(text):
                candidates.append((text, line.size, "bold"))
        found.append(candidates)

    # Larger text is a higher level; bold body-size text comes below every larger size.
    sizes = sorted({size for page in found for _, size, why in page if why == "size" and size}, reverse=True)
    result: list[tuple[Heading, ...]] = []
    for page in found:
        headings: list[Heading] = []
        for text, size, why in page:
            if why == "size" and size:
                level = sizes.index(size) + 1
            elif why == "chapter":
                level = 1
            else:
                level = len(sizes) + 1
            headings.append(Heading(min(level, MAX_LEVEL), text))
        result.append(tuple(headings))
    return result


def markdown_headings(text: str) -> tuple[Heading, ...]:
    """Headings of a Markdown file, which marks them itself."""
    headings: list[Heading] = []
    for line in text.split("\n"):
        match = _MARKDOWN.match(line.strip())
        if match:
            headings.append(Heading(min(len(match.group(1)), MAX_LEVEL), match.group(2)))
    return tuple(headings)


def page_markdown(text: str, headings: Sequence[Heading]) -> str:
    """The page text with its headings marked as Markdown. A heading wrapped over two lines becomes one."""
    levels = {heading.text: heading.level for heading in headings}
    lines: list[str] = []
    previous: int | None = None  # level of the heading on the line just before
    for line in text.split("\n"):
        stripped = line.strip()
        level = levels.get(stripped)
        if stripped.startswith("#") or level is None:
            lines.append(line)
            previous = None
        elif previous == level:
            lines[-1] = f"{lines[-1]} {stripped}"
        else:
            lines.append(f"{'#' * level} {stripped}")
            previous = level
    return "\n".join(lines)


def parse_heading(line: str) -> Heading | None:
    """A Markdown heading line of a stored page, or None for any other line."""
    match = _MARKDOWN.match(line.strip())
    return Heading(min(len(match.group(1)), MAX_LEVEL), match.group(2)) if match else None
