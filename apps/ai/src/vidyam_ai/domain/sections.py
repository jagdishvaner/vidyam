"""A file's sections: which pages cover which syllabus chapter (plan v3 §5, step 5). Pure functions; no I/O.

Evidence is used in order of trust:
1. the manifest: page ranges per chapter, or one chapter for the whole file (certain);
2. the file's own table of contents ("विषय-सूची", "Contents"), titles matched to the syllabus;
3. its top-level headings, matched the same way.

A section whose title matches no syllabus node is still recorded, without a node: it keeps the file's
structure for citations, and a person can map it later. Chunks inherit their chapter from the section they
fall in, which is how a teacher's chapter picks reach the right pages.
"""

import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import pairwise
from typing import Literal
from uuid import UUID

from vidyam_ai.domain.chunking import Chunk
from vidyam_ai.domain.headings import parse_heading

SectionOrigin = Literal["manifest", "toc", "heading"]

MIN_MATCH = 0.6  # below this, a title is not taken to be about the node (the tag would need review)
TOC_PAGES = 12  # a table of contents is near the front
MIN_TOC_ENTRIES = 3


@dataclass(frozen=True)
class SyllabusNode:
    id: UUID
    parent_id: UUID | None
    level: str  # subject, unit, chapter, topic, subtopic
    path: str  # code path: "science/physics/motion"
    name_en: str
    name_hi: str | None
    aliases: tuple[str, ...] = ()


@dataclass(frozen=True)
class ManifestSection:
    page_start: int
    page_end: int
    node_id: UUID
    title: str | None


@dataclass(frozen=True)
class Structure:
    """What the manifest said about the file, resolved to syllabus ids at import (sources.meta.structure)."""

    chapter: UUID | None = None
    sections: tuple[ManifestSection, ...] = ()


@dataclass(frozen=True)
class PlannedSection:
    title: str
    page_start: int | None
    page_end: int | None
    node_id: UUID | None
    origin: SectionOrigin
    confidence: float | None
    heading: str | None = None  # the heading that opens it (files without pages are matched by heading)


@dataclass(frozen=True)
class LabelledPage:
    page_no: int | None
    label: str | None  # printed page number, where known
    text: str  # Markdown


# --- Matching titles to the syllabus -------------------------------------------------------------------

_NUMBERING = re.compile(
    r"^(?:(?:अध्याय|पाठ|इकाई|खण्ड|खंड|भाग|chapter|unit|lesson|part)\s*)?[-–—:.]?\s*(?:\d+|[०-९]+|[ivxlc]+)?"
    r"\s*[-–—:.)]\s*",
    re.IGNORECASE,
)
_STOPWORDS = frozenset(
    [
        *("के", "की", "का", "को", "में", "से", "पर", "एवं", "और", "तथा", "व", "या", "एक", "नोट्स"),
        *("the", "of", "and", "in", "on", "to", "for", "a", "an", "its", "their", "with", "notes"),
        *("chapter", "अध्याय", "unit", "इकाई", "पाठ", "lesson", "part", "भाग"),
    ]
)


def _tokens(text: str) -> frozenset[str]:
    text = unicodedata.normalize("NFC", text).casefold()
    text = _NUMBERING.sub("", text.strip(), count=1)
    words = re.findall(r"[\wऀ-ॿ]+", text)
    return frozenset(word for word in words if word not in _STOPWORDS and not word.isdigit())


def _similarity(a: frozenset[str], b: frozenset[str]) -> float:
    return 2 * len(a & b) / (len(a) + len(b)) if a and b else 0.0


_LEVEL_PREFERENCE = {"chapter": 0, "unit": 1, "topic": 2, "subtopic": 3}


def match_node(title: str, nodes: Sequence[SyllabusNode]) -> tuple[SyllabusNode, float] | None:
    """The syllabus node a section title is about, by its English or Hindi name or an alias, with how well it
    matches (0–1). Chapters win ties over units and topics."""
    words = _tokens(title)
    best: tuple[float, int, SyllabusNode] | None = None
    for node in nodes:
        if node.level not in _LEVEL_PREFERENCE:
            continue
        names = (node.name_en, node.name_hi or "", *node.aliases)
        score = max(_similarity(words, _tokens(name)) for name in names)
        key = (round(score, 3), -_LEVEL_PREFERENCE[node.level])
        if score > 0 and (best is None or key > (best[0], best[1])):
            best = (key[0], key[1], node)
    return (best[2], best[0]) if best else None


# --- Tables of contents --------------------------------------------------------------------------------

_TOC_TITLE = re.compile(r"^(?:contents|table of contents|index|विषय[- ]?सूची|अनुक्रम(?:णिका)?|सूची)$", re.I)
_TOC_ENTRY = re.compile(r"^(?P<title>.{3,90}?)\s*(?:\.{2,}|…+|·{2,}|_{2,}|\s{2,}|\t)\s*(?P<page>\d{1,4})$")
_TOC_PLAIN_ENTRY = re.compile(r"^(?P<title>\D.{2,90}?)\s+(?P<page>\d{1,4})$")


def find_toc(pages: Sequence[LabelledPage]) -> list[tuple[str, str]]:
    """Entries (title, printed page) of a table of contents near the start of the file, or nothing. A page
    counts when it is titled like one, or when most of its lines end in dot leaders and a page number."""
    for page in pages[:TOC_PAGES]:
        lines = [line.strip().lstrip("#").strip() for line in page.text.split("\n") if line.strip()]
        titled = any(_TOC_TITLE.match(line) for line in lines)
        pattern = _TOC_PLAIN_ENTRY if titled else _TOC_ENTRY
        entries: list[tuple[str, str]] = []
        for line in lines:
            match = _TOC_ENTRY.match(line) or pattern.match(line)
            if match:
                entries.append((match.group("title").strip(" .:-–"), match.group("page")))
        numbers = [int(page) for _, page in entries]
        ascending = all(a <= b for a, b in pairwise(numbers))
        if len(entries) >= MIN_TOC_ENTRIES and ascending and (titled or len(entries) * 2 >= len(lines)):
            return entries
    return []


# --- Sections ------------------------------------------------------------------------------------------


def _ranges(starts: Sequence[int], last_page: int) -> list[tuple[int, int]]:
    """Each start runs up to the page before the next one starts (or that page, if both start on it)."""
    ends = [max(start, nxt - 1) for start, nxt in zip(starts, [*starts[1:], last_page + 1], strict=True)]
    return list(zip(starts, ends, strict=True))


def plan_sections(
    pages: Sequence[LabelledPage],
    structure: Structure,
    nodes: Sequence[SyllabusNode],
    *,
    hindi: bool,
) -> list[PlannedSection]:
    """`nodes`: the syllabus under the file's subject (or all of it, for a file spanning subjects).
    `hindi`: name sections from the manifest in Hindi when the file is Hindi."""
    by_id = {node.id: node for node in nodes}
    numbers = [page.page_no for page in pages if page.page_no is not None]
    first, last = (min(numbers), max(numbers)) if numbers else (None, None)

    def name(node_id: UUID) -> str:
        node = by_id.get(node_id)
        if node is None:
            return "—"
        return (node.name_hi if hindi and node.name_hi else None) or node.name_en

    if structure.sections:
        return [
            PlannedSection(s.title or name(s.node_id), s.page_start, s.page_end, s.node_id, "manifest", 1.0)
            for s in sorted(structure.sections, key=lambda s: s.page_start)
        ]
    if structure.chapter:
        return [PlannedSection(name(structure.chapter), first, last, structure.chapter, "manifest", 1.0)]

    def matched(title: str, origin: SectionOrigin, start: int | None, end: int | None) -> PlannedSection:
        found = match_node(title, nodes)
        node, score = found if found and found[1] >= MIN_MATCH else (None, None)
        heading = title if origin == "heading" else None
        return PlannedSection(title, start, end, node.id if node else None, origin, score, heading)

    toc = find_toc(pages) if last is not None else []
    if toc:
        by_label = {page.label: page.page_no for page in pages if page.label and page.page_no is not None}
        starts: list[tuple[str, int]] = []
        for title, printed in toc:
            page_no = by_label.get(printed, int(printed))
            if first is not None and last is not None and first <= page_no <= last:
                starts.append((title, page_no))
        if len(starts) >= MIN_TOC_ENTRIES:
            ranges = _ranges([page_no for _, page_no in starts], last or 0)
            return [
                matched(title, "toc", start, end)
                for (title, _), (start, end) in zip(starts, ranges, strict=True)
            ]

    headings: list[tuple[int, str, int | None]] = []  # (level, text, page)
    for page in pages:
        for line in page.text.split("\n"):
            heading = parse_heading(line)
            if heading:
                headings.append((heading.level, heading.text, page.page_no))
    if not headings:
        return []
    top = min(level for level, _, _ in headings)
    tops = [(text, page_no) for level, text, page_no in headings if level == top]
    if last is None:
        return [matched(text, "heading", None, None) for text, _ in tops]
    ranges = _ranges([page_no or first or 1 for _, page_no in tops], last)
    return [
        matched(text, "heading", start, end) for (text, _), (start, end) in zip(tops, ranges, strict=True)
    ]


def section_of(chunk: Chunk, sections: Sequence[PlannedSection]) -> int | None:
    """Index of the section a chunk falls in: by its first page, or for files without pages by the heading
    that opens the section."""
    for index, section in enumerate(sections):
        if chunk.page_start is not None and section.page_start is not None and section.page_end is not None:
            if section.page_start <= chunk.page_start <= section.page_end:
                return index
        elif (
            chunk.page_start is None and section.heading is not None and section.heading in chunk.heading_path
        ):
            return index
    if chunk.page_start is None and len(sections) == 1 and sections[0].page_start is None:
        return 0
    return None
