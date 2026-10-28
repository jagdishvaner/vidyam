"""Turning the raw text of a page into trustworthy Unicode, or deciding it needs OCR. Pure functions; no I/O.

Extractors (PDF, Word, plain text) report text as runs tagged with their font. Fonts are classified once per
document; Kruti Dev runs are converted; and a page whose text is missing, damaged or set in a legacy font we
can't convert is marked for OCR instead of feeding garbage into search.
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from vidyam_ai.domain.devanagari import (
    LegacyEncoding,
    clean_text,
    devanagari_quality,
    krutidev_to_unicode,
    legacy_encoding,
    looks_like_krutidev,
)

ParseMethod = Literal["text_layer", "legacy_font"]

MIN_TEXT_CHARS = 20  # fewer visible characters than this and a page has no usable text layer
MIN_HINDI_QUALITY = 0.85  # below this share of well-formed Hindi words, OCR the page instead

# Which reader produced a page's text, recorded per page (plan v3 §5): a fix to one reader or converter
# re-reads only the pages it produced. Bump a number whenever its output changes.
EXTRACTORS = {"pdf": "pdf-2", "docx": "docx-2", "text": "text-2", "image": "image-1"}
KRUTIDEV_CONVERTER = "krutidev-1"


@dataclass(frozen=True)
class TextRun:
    text: str
    font: str | None  # None for characters the extractor inserted itself (spaces, line breaks)
    size: float | None = None  # in points, where the format has sizes
    bold: bool = False


@dataclass(frozen=True)
class Heading:
    level: int  # 1 for a chapter, 2 and 3 below it
    text: str  # clean Unicode, as the line appears in the page text


@dataclass(frozen=True)
class PageReading:
    page_no: int | None
    text: str  # clean Unicode; kept for inspection even when the page needs OCR
    method: ParseMethod | None
    needs_ocr: bool
    confidence: float | None
    note: str | None = None
    headings: tuple[Heading, ...] = ()
    label: str | None = None  # the page number printed in the file's own page labels, if it has them
    extractor: str | None = None  # EXTRACTORS entry, plus the converter for legacy fonts


def font_family(font: str) -> str:
    return re.sub(r"^[A-Z]{6}\+", "", font)


def classify_fonts(samples: Mapping[str, str]) -> dict[str, LegacyEncoding | None]:
    """Decide each font's encoding from its name, or, for names that say nothing ("F1", "Arial" reused by a
    typist), from what its text looks like across the whole document."""
    result: dict[str, LegacyEncoding | None] = {}
    for font, sample in samples.items():
        encoding = legacy_encoding(font)
        if encoding is None and looks_like_krutidev(sample):
            encoding = "krutidev"
        result[font] = encoding
    return result


# Replacement characters and the Private Use Area: glyphs a PDF never mapped back to real characters.
_BROKEN = re.compile(f"[\N{REPLACEMENT CHARACTER}{chr(0xE000)}-{chr(0xF8FF)}]")


def unicode_runs(
    runs: Sequence[TextRun], encodings: Mapping[str, LegacyEncoding | None]
) -> tuple[list[TextRun], bool, set[str]]:
    """Runs with Kruti Dev text converted to Unicode; whether any was converted; and the legacy fonts that
    have no converter."""
    converted: list[TextRun] = []
    legacy = False
    unconvertible: set[str] = set()
    for run in runs:
        encoding = encodings.get(run.font) if run.font else None
        if encoding == "krutidev":
            converted.append(TextRun(krutidev_to_unicode(run.text), run.font, run.size, run.bold))
            legacy = True
            continue
        if encoding == "unsupported" and run.font:
            unconvertible.add(font_family(run.font))
        converted.append(run)
    return converted, legacy, unconvertible


def read_page(
    page_no: int | None,
    runs: Sequence[TextRun],
    encodings: Mapping[str, LegacyEncoding | None],
    *,
    scanned: bool = False,
) -> PageReading:
    """`scanned`: most of the page is one picture, so any text layer came from the scanner's own OCR."""
    converted, legacy, unconvertible = unicode_runs(runs, encodings)
    text = clean_text("".join(run.text for run in converted))
    method: ParseMethod = "legacy_font" if legacy else "text_layer"
    visible = len(re.sub(r"\s", "", text))

    def ocr(note: str, keep: str = text) -> PageReading:
        return PageReading(page_no, keep, None, needs_ocr=True, confidence=None, note=note)

    if unconvertible:
        return ocr(f"set in {', '.join(sorted(unconvertible))}, a legacy Hindi font without a converter yet")
    if visible < MIN_TEXT_CHARS:
        if scanned:
            return ocr("scanned page without a text layer", keep="")
        return PageReading(page_no, text, method, needs_ocr=False, confidence=None, note="blank page")
    if len(_BROKEN.findall(text)) > visible * 0.02:
        return ocr("the PDF's text layer has no proper character map")
    quality = devanagari_quality(text)
    if quality is not None and quality < MIN_HINDI_QUALITY:
        return ocr(f"Hindi text looks damaged ({quality:.0%} of words well-formed)")
    confidence = 1.0 if quality is None else quality
    note = None
    if scanned:
        confidence = round(confidence * 0.9, 3)  # scanner OCR: usable, but worth re-reading with vision OCR
        note = "text from the scan's own OCR layer"
    return PageReading(page_no, text, method, needs_ocr=False, confidence=confidence, note=note)
