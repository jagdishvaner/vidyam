"""Word (.docx) and plain-text files → one page of font-tagged text runs."""

import re
from collections import defaultdict
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path
from zipfile import BadZipFile

from docx import Document
from docx.document import Document as DocxDocument
from docx.opc.exceptions import PackageNotFoundError
from docx.styles.style import BaseStyle, CharacterStyle
from docx.text.hyperlink import Hyperlink
from docx.text.paragraph import Paragraph
from docx.text.run import Run

from vidyam_ai.domain.devanagari import clean_text
from vidyam_ai.domain.documents import (
    EXTRACTORS,
    KRUTIDEV_CONVERTER,
    Heading,
    PageReading,
    TextRun,
    classify_fonts,
    read_page,
    unicode_runs,
)
from vidyam_ai.domain.headings import MAX_LEVEL, find_headings, markdown_headings, styled_lines
from vidyam_ai.infrastructure.extraction.errors import UnreadableDocument

_DEFAULT_FONT = "default"
_HEADING_STYLE = re.compile(r"^(?:Heading\s*(\d)|Title)$", re.IGNORECASE)


def _style_font(style: BaseStyle | None) -> str | None:
    """A paragraph's font comes from its style, or the style it is based on, and so on."""
    while isinstance(style, CharacterStyle):  # paragraph styles are character styles too
        if style.font.name:
            return style.font.name
        style = style.base_style
    return None


def _style_size(style: BaseStyle | None) -> float | None:
    while isinstance(style, CharacterStyle):
        if style.font.size is not None:
            return style.font.size.pt
        style = style.base_style
    return None


def _style_bold(style: BaseStyle | None) -> bool:
    while isinstance(style, CharacterStyle):
        if style.font.bold is not None:
            return style.font.bold
        style = style.base_style
    return False


def _heading_level(paragraph: Paragraph) -> int | None:
    """Level of a paragraph set in a heading style ("Heading 2" → 2, "Title" → 1)."""
    name = paragraph.style.name if paragraph.style is not None else None
    match = _HEADING_STYLE.match(name or "")
    if not match:
        return None
    return min(int(match.group(1) or "1") or 1, MAX_LEVEL)


def _paragraphs(document: DocxDocument) -> Iterator[Paragraph | str]:
    """Body paragraphs and table cells in reading order; "\\n" marks the end of a table row."""
    for block in document.iter_inner_content():
        if isinstance(block, Paragraph):
            yield block
            continue
        for row in block.rows:
            for cell in row.cells:
                yield from cell.paragraphs
            yield "\n"


def extract_docx(path: str) -> list[PageReading]:
    try:
        document = Document(path)
    except (PackageNotFoundError, BadZipFile, KeyError) as error:
        raise UnreadableDocument(f"Word file can't be opened: {error}") from error
    default_font = _style_font(document.styles["Normal"]) or _DEFAULT_FONT
    runs: list[TextRun] = []
    styled: list[tuple[int, list[TextRun]]] = []  # paragraphs set in a heading style, with their level
    samples: defaultdict[str, list[str]] = defaultdict(list)
    for paragraph in _paragraphs(document):
        if isinstance(paragraph, str):
            runs.append(TextRun(paragraph, None))
            continue
        paragraph_font = _style_font(paragraph.style) or default_font
        paragraph_size = _style_size(paragraph.style)
        paragraph_bold = _style_bold(paragraph.style)
        paragraph_runs: list[TextRun] = []
        for item in paragraph.iter_inner_content():
            for run in item.runs if isinstance(item, Hyperlink) else [item]:
                assert isinstance(run, Run)
                font = run.font.name or paragraph_font
                size = run.font.size.pt if run.font.size is not None else paragraph_size
                bold = run.bold if run.bold is not None else paragraph_bold
                paragraph_runs.append(TextRun(run.text, font, size, bold))
                samples[font].append(run.text)
        runs.extend(paragraph_runs)
        runs.append(TextRun("\n", None))
        level = _heading_level(paragraph)
        if level:
            styled.append((level, paragraph_runs))
    encodings = classify_fonts({font: "".join(parts)[:4000] for font, parts in samples.items()})
    reading = read_page(None, runs, encodings)
    if styled:  # the author marked headings: trust the styles
        headings = tuple(
            Heading(level, text)
            for level, paragraph_runs in styled
            if (text := clean_text("".join(r.text for r in unicode_runs(paragraph_runs, encodings)[0])))
        )
    else:
        [headings] = find_headings([styled_lines(unicode_runs(runs, encodings)[0])])
    legacy = f"+{KRUTIDEV_CONVERTER}" if reading.method == "legacy_font" else ""
    return [replace(reading, headings=headings, extractor=EXTRACTORS["docx"] + legacy)]


def decode_text(raw: bytes) -> str:
    """UTF-8 (with or without BOM); otherwise Windows-1252, the encoding legacy Hindi .txt files use."""
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("cp1252", errors="replace")


def extract_text(path: str, *, markdown: bool = False) -> list[PageReading]:
    text = decode_text(Path(path).read_bytes())
    encodings = classify_fonts({_DEFAULT_FONT: text[:20000]})
    runs = [TextRun(text, _DEFAULT_FONT)]
    reading = read_page(None, runs, encodings)
    if markdown:  # Markdown marks its own headings; plain text only has "Chapter 3"-style lines
        headings = markdown_headings(reading.text)
    else:
        [headings] = find_headings([styled_lines(unicode_runs(runs, encodings)[0])])
    legacy = f"+{KRUTIDEV_CONVERTER}" if reading.method == "legacy_font" else ""
    return [replace(reading, headings=headings, extractor=EXTRACTORS["text"] + legacy)]
