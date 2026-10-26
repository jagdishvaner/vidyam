"""Word (.docx) and plain-text files → one page of font-tagged text runs."""

from collections import defaultdict
from collections.abc import Iterator
from pathlib import Path
from zipfile import BadZipFile

from docx import Document
from docx.document import Document as DocxDocument
from docx.opc.exceptions import PackageNotFoundError
from docx.styles.style import BaseStyle, CharacterStyle
from docx.text.hyperlink import Hyperlink
from docx.text.paragraph import Paragraph
from docx.text.run import Run

from vidyam_ai.domain.documents import PageReading, TextRun, classify_fonts, read_page
from vidyam_ai.infrastructure.extraction.errors import UnreadableDocument

_DEFAULT_FONT = "default"


def _style_font(style: BaseStyle | None) -> str | None:
    """A paragraph's font comes from its style, or the style it is based on, and so on."""
    while isinstance(style, CharacterStyle):  # paragraph styles are character styles too
        if style.font.name:
            return style.font.name
        style = style.base_style
    return None


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
    samples: defaultdict[str, list[str]] = defaultdict(list)
    for paragraph in _paragraphs(document):
        if isinstance(paragraph, str):
            runs.append(TextRun(paragraph, None))
            continue
        paragraph_font = _style_font(paragraph.style) or default_font
        for item in paragraph.iter_inner_content():
            for run in item.runs if isinstance(item, Hyperlink) else [item]:
                assert isinstance(run, Run)
                font = run.font.name or paragraph_font
                runs.append(TextRun(run.text, font))
                samples[font].append(run.text)
        runs.append(TextRun("\n", None))
    encodings = classify_fonts({font: "".join(parts)[:4000] for font, parts in samples.items()})
    return [read_page(None, runs, encodings)]


def decode_text(raw: bytes) -> str:
    """UTF-8 (with or without BOM); otherwise Windows-1252, the encoding legacy Hindi .txt files use."""
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("cp1252", errors="replace")


def extract_text(path: str) -> list[PageReading]:
    text = decode_text(Path(path).read_bytes())
    encodings = classify_fonts({_DEFAULT_FONT: text[:20000]})
    return [read_page(None, [TextRun(text, _DEFAULT_FONT)], encodings)]
