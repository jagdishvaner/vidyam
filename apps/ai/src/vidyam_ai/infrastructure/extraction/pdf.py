"""PDF → font-tagged text runs per page, through PDFium (Chrome's PDF engine; pypdfium2 is BSD/Apache-2.0)."""

import ctypes
from collections import defaultdict
from collections.abc import Iterator
from typing import cast

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c

from vidyam_ai.domain.documents import PageReading, TextRun, classify_fonts, read_page
from vidyam_ai.infrastructure.extraction.errors import UnreadableDocument

SCANNED_COVERAGE = 0.6  # a page mostly covered by pictures is a scan
_FONT_SAMPLE_CHARS = 4000  # per font, enough to recognize Kruti Dev text when the font name says nothing


def _runs(textpage: pdfium.PdfTextPage) -> list[TextRun]:
    runs: list[TextRun] = []
    chars: list[str] = []
    font: str | None = None
    name = ctypes.create_string_buffer(256)
    flags = ctypes.c_int()
    count = cast(int, textpage.count_chars())
    for index in range(count):
        code = cast(int, pdfium_c.FPDFText_GetUnicode(textpage.raw, index))
        if not code:
            continue
        char_font = font  # characters PDFium inserted (spaces, line breaks) stay in the current run
        generated = cast(int, pdfium_c.FPDFText_IsGenerated(textpage.raw, index))
        if not generated:
            info = pdfium_c.FPDFText_GetFontInfo(textpage.raw, index, name, len(name), ctypes.byref(flags))
            size = cast(int, info)
            char_font = name.value.decode("utf-8", "replace") if size else None
        if char_font != font and chars:
            runs.append(TextRun("".join(chars), font))
            chars = []
        font = char_font
        chars.append(chr(code))
    if chars:
        runs.append(TextRun("".join(chars), font))
    return runs


def _image_coverage(page: pdfium.PdfPage) -> float:
    width, height = page.get_size()
    if width <= 0 or height <= 0:
        return 0.0
    covered = 0.0
    images = cast(
        Iterator[pdfium.PdfObject], page.get_objects(filter=[pdfium_c.FPDF_PAGEOBJ_IMAGE], max_depth=3)
    )
    for image in images:
        bounds: tuple[float, float, float, float] = image.get_bounds()
        left, bottom, right, top = bounds
        overlap_width = max(0.0, min(right, width) - max(left, 0.0))
        overlap_height = max(0.0, min(top, height) - max(bottom, 0.0))
        covered += overlap_width * overlap_height
    return min(1.0, covered / (width * height))


def extract_pdf(path: str) -> list[PageReading]:
    """Runs in a worker process (CPU-heavy): every page of the PDF, read and judged."""
    try:
        pdf = pdfium.PdfDocument(path)
    except pdfium.PdfiumError as error:
        raise UnreadableDocument(f"PDF can't be opened: {error}") from error
    try:
        pages: list[tuple[list[TextRun], bool]] = []
        samples: defaultdict[str, list[str]] = defaultdict(list)
        sampled: defaultdict[str, int] = defaultdict(int)
        for page in pdf:
            textpage = page.get_textpage()
            runs = _runs(textpage)
            pages.append((runs, _image_coverage(page) >= SCANNED_COVERAGE))
            for run in runs:
                if run.font and sampled[run.font] < _FONT_SAMPLE_CHARS:
                    samples[run.font].append(run.text)
                    sampled[run.font] += len(run.text)
            textpage.close()
            page.close()
        encodings = classify_fonts({font: " ".join(parts) for font, parts in samples.items()})
        return [
            read_page(number, runs, encodings, scanned=scanned)
            for number, (runs, scanned) in enumerate(pages, start=1)
        ]
    finally:
        pdf.close()
