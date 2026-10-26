"""Builds small documents shaped like the center's real ones, so extraction is tested without shipping
copyrighted books. Kruti Dev files are reproduced the way they reach us: a font named Kruti Dev whose text
layer holds Latin codes ("Hkkjr" for भारत)."""

import io
from collections.abc import Sequence
from pathlib import Path

from docx import Document
from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

FONTS = Path(__file__).parent / "fonts"
pdfmetrics.registerFont(TTFont("NotoDevanagari", str(FONTS / "NotoSansDevanagari-Regular.ttf")))


def _lines(pdf: canvas.Canvas, font: str, lines: list[str], *, top: float = 780) -> None:
    pdf.setFont(font, 12)
    for number, line in enumerate(lines):
        pdf.drawString(60, top - number * 18, line)


def unicode_pdf(path: Path, pages: list[list[str]]) -> Path:
    """Pages of Unicode text; lines with Devanagari use a Devanagari font, the rest Helvetica."""
    pdf = canvas.Canvas(str(path), pagesize=A4)
    for page in pages:
        for number, line in enumerate(page):
            hindi = any(
                "\N{DEVANAGARI SIGN INVERTED CANDRABINDU}" <= c <= "\N{DEVANAGARI LETTER BBA}" for c in line
            )
            _lines(pdf, "NotoDevanagari" if hindi else "Helvetica", [line], top=780 - number * 18)
        pdf.showPage()
    pdf.save()
    return path


def krutidev_pdf(path: Path, krutidev_lines: Sequence[str], english_lines: Sequence[str] = ()) -> Path:
    """Kruti Dev text plus optional English, as a Word-made Kruti Dev PDF presents it."""
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    _lines(pdf, "Times-Roman", list(english_lines), top=800)  # F1: a real Latin font
    _lines(pdf, "Helvetica", list(krutidev_lines), top=700)  # F2: renamed to Kruti Dev below
    pdf.showPage()
    pdf.save()
    data = buffer.getvalue()
    # Same length as "Helvetica", so the PDF's byte offsets stay valid.
    renamed = data.replace(b"/BaseFont /Helvetica ", b"/BaseFont /KrutiDev01 ")
    assert renamed != data
    path.write_bytes(renamed)
    return path


def scanned_pdf(path: Path) -> Path:
    """A page that is one photographed image and has no text layer."""
    image = Image.new("RGB", (1240, 1754), "white")
    image_path = path.with_suffix(".png")
    image.save(image_path)
    pdf = canvas.Canvas(str(path), pagesize=A4)
    width, height = A4
    pdf.drawImage(str(image_path), 0, 0, width=width, height=height)
    pdf.showPage()
    pdf.save()
    return path


def krutidev_docx(path: Path, krutidev_paragraphs: list[str], english_paragraphs: list[str]) -> Path:
    document = Document()
    for text in english_paragraphs:
        document.add_paragraph().add_run(text).font.name = "Times New Roman"
    for text in krutidev_paragraphs:
        document.add_paragraph().add_run(text).font.name = "Kruti Dev 010"
    document.save(str(path))
    return path
