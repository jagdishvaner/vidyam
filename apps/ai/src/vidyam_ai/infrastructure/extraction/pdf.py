"""PDF → font-tagged text runs per page, through PDFium (Chrome's PDF engine; pypdfium2 is BSD/Apache-2.0)."""

import ctypes
from collections import defaultdict
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path
from typing import cast

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c
from PIL import Image

from vidyam_ai.domain.documents import (
    EXTRACTORS,
    KRUTIDEV_CONVERTER,
    PageReading,
    TextRun,
    classify_fonts,
    read_page,
    unicode_runs,
)
from vidyam_ai.domain.headings import find_headings, styled_lines
from vidyam_ai.infrastructure.extraction.errors import UnreadableDocument

SCANNED_COVERAGE = 0.6  # a page mostly covered by pictures is a scan
BOLD_WEIGHT = 600
IMAGE_LONG_EDGE = 1568  # pixels: what vision models read at full detail (larger images are scaled down)
_FONT_SAMPLE_CHARS = 4000  # per font, enough to recognize Kruti Dev text when the font name says nothing


def _runs(textpage: pdfium.PdfTextPage) -> list[TextRun]:
    """The page's characters grouped into runs of one font, size and weight."""
    runs: list[TextRun] = []
    chars: list[str] = []
    style: tuple[str | None, float | None, bool] = (None, None, False)
    name = ctypes.create_string_buffer(256)
    flags = ctypes.c_int()
    count = cast(int, textpage.count_chars())
    for index in range(count):
        code = cast(int, pdfium_c.FPDFText_GetUnicode(textpage.raw, index))
        if not code:
            continue
        char_style = style  # characters PDFium inserted (spaces, line breaks) stay in the current run
        generated = cast(int, pdfium_c.FPDFText_IsGenerated(textpage.raw, index))
        if not generated:
            info = pdfium_c.FPDFText_GetFontInfo(textpage.raw, index, name, len(name), ctypes.byref(flags))
            font = name.value.decode("utf-8", "replace") if cast(int, info) else None
            size = round(cast(float, pdfium_c.FPDFText_GetFontSize(textpage.raw, index)), 1)
            weight = cast(int, pdfium_c.FPDFText_GetFontWeight(textpage.raw, index))
            bold = weight >= BOLD_WEIGHT or "bold" in (font or "").lower()
            char_style = (font, size or None, bold)
        if char_style != style and chars:
            runs.append(TextRun("".join(chars), *style))
            chars = []
        style = char_style
        chars.append(chr(code))
    if chars:
        runs.append(TextRun("".join(chars), *style))
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
        readings = [
            read_page(number, runs, encodings, scanned=scanned)
            for number, (runs, scanned) in enumerate(pages, start=1)
        ]
        headings = find_headings([styled_lines(unicode_runs(runs, encodings)[0]) for runs, _ in pages])
        labels = [pdf.get_page_label(index).strip() or None for index in range(len(pdf))]
        return [
            replace(
                reading,
                headings=() if reading.needs_ocr else page_headings,
                label=label,
                extractor=EXTRACTORS["pdf"]
                + (f"+{KRUTIDEV_CONVERTER}" if reading.method == "legacy_font" else ""),
            )
            for reading, page_headings, label in zip(readings, headings, labels, strict=True)
        ]
    finally:
        pdf.close()


def render_pdf_pages(path: str, out_dir: str) -> dict[int, str]:
    """Runs in a worker process: every page as a PNG, its longer side IMAGE_LONG_EDGE pixels, for vision OCR,
    figures and citation previews. Returns the file written for each page number."""
    try:
        pdf = pdfium.PdfDocument(path)
    except pdfium.PdfiumError as error:
        raise UnreadableDocument(f"PDF can't be opened: {error}") from error
    written: dict[int, str] = {}
    try:
        for number, page in enumerate(pdf, start=1):
            width, height = page.get_size()
            scale = IMAGE_LONG_EDGE / max(width, height, 1)
            image = cast(Image.Image, page.render(scale=scale).to_pil())
            target = Path(out_dir) / f"{number}.png"
            image.save(target, format="PNG", optimize=True)
            written[number] = str(target)
            page.close()
    finally:
        pdf.close()
    return written
