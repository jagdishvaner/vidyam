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


@dataclass(frozen=True)
class TextRun:
    text: str
    font: str | None  # None for characters the extractor inserted itself (spaces, line breaks)


@dataclass(frozen=True)
class PageReading:
    page_no: int | None
    text: str  # clean Unicode; kept for inspection even when the page needs OCR
    method: ParseMethod | None
    needs_ocr: bool
    confidence: float | None
    note: str | None = None


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


def read_page(
    page_no: int | None,
    runs: Sequence[TextRun],
    encodings: Mapping[str, LegacyEncoding | None],
    *,
    scanned: bool = False,
) -> PageReading:
    """`scanned`: most of the page is one picture, so any text layer came from the scanner's own OCR."""
    parts: list[str] = []
    legacy = False
    unconvertible: set[str] = set()
    for run in runs:
        encoding = encodings.get(run.font) if run.font else None
        if encoding == "krutidev":
            parts.append(krutidev_to_unicode(run.text))
            legacy = True
        else:
            if encoding == "unsupported" and run.font:
                unconvertible.add(font_family(run.font))
            parts.append(run.text)
    text = clean_text("".join(parts))
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
