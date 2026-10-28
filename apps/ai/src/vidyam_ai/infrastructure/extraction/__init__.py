"""Reading uploaded files. `extract` runs in a worker process (see CpuPool), so it takes a path and returns
plain data."""

from pathlib import Path

from PIL import Image, UnidentifiedImageError

from vidyam_ai.domain.documents import EXTRACTORS, PageReading
from vidyam_ai.infrastructure.extraction.errors import UnreadableDocument, UnsupportedDocument
from vidyam_ai.infrastructure.extraction.office import extract_docx, extract_text
from vidyam_ai.infrastructure.extraction.pdf import IMAGE_LONG_EDGE, extract_pdf, render_pdf_pages

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
IMAGES = frozenset({"image/jpeg", "image/png", "image/tiff", "image/webp"})


def extract(path: str, mime_type: str) -> list[PageReading]:
    if mime_type == "application/pdf":
        return extract_pdf(path)
    if mime_type == DOCX:
        return extract_docx(path)
    if mime_type in ("text/plain", "text/markdown"):
        return extract_text(path, markdown=mime_type == "text/markdown")
    if mime_type in IMAGES:
        return [
            PageReading(
                1,
                "",
                None,
                needs_ocr=True,
                confidence=None,
                note="image: text needs OCR",
                extractor=EXTRACTORS["image"],
            )
        ]
    raise UnsupportedDocument(f"can't read {mime_type} files yet")


def render_pages(path: str, mime_type: str, out_dir: str) -> dict[int, str]:
    """Page images (PNG) for files that have pages: PDFs and pictures. Word and text files have none."""
    if mime_type == "application/pdf":
        return render_pdf_pages(path, out_dir)
    if mime_type in IMAGES:
        try:
            with Image.open(path) as image:
                image.thumbnail((IMAGE_LONG_EDGE, IMAGE_LONG_EDGE))
                target = Path(out_dir) / "1.png"
                image.convert("RGB").save(target, format="PNG", optimize=True)
        except (UnidentifiedImageError, OSError) as error:
            raise UnreadableDocument(f"image can't be opened: {error}") from error
        return {1: str(target)}
    return {}


__all__ = ["UnreadableDocument", "UnsupportedDocument", "extract", "render_pages"]
