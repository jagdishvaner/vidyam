"""Reading uploaded files. `extract` runs in a worker process (see CpuPool), so it takes a path and returns
plain data."""

from vidyam_ai.domain.documents import PageReading
from vidyam_ai.infrastructure.extraction.errors import UnreadableDocument, UnsupportedDocument
from vidyam_ai.infrastructure.extraction.office import extract_docx, extract_text
from vidyam_ai.infrastructure.extraction.pdf import extract_pdf

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
IMAGES = frozenset({"image/jpeg", "image/png", "image/tiff", "image/webp"})


def extract(path: str, mime_type: str) -> list[PageReading]:
    if mime_type == "application/pdf":
        return extract_pdf(path)
    if mime_type == DOCX:
        return extract_docx(path)
    if mime_type in ("text/plain", "text/markdown"):
        return extract_text(path)
    if mime_type in IMAGES:
        return [PageReading(1, "", None, needs_ocr=True, confidence=None, note="image: text needs OCR")]
    raise UnsupportedDocument(f"can't read {mime_type} files yet")


__all__ = ["UnreadableDocument", "UnsupportedDocument", "extract"]
