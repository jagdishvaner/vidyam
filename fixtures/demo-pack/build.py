"""Builds the demo pack's files (files/) from their sources (texts/, questions/), then reads every file back
with the AI engine's own extractor and fails if the text differs from what was drawn. The sources are
therefore the exact ground truth for extraction, OCR and retrieval tests.

    pnpm demo:build                 # everything
    pnpm demo:build -- --only light # files whose name contains "light"

Hindi is drawn glyph by glyph (ReportLab does not shape Devanagari), so matras sit slightly off on screen
while the text layer is exact. The scan is rendered by headless Chrome, which shapes Hindi properly, because
OCR reads pixels.
"""

import argparse
import io
import json
import random
import re
import subprocess
import sys
import tempfile
import unicodedata
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from docx import Document
from docx.enum.text import WD_BREAK
from PIL import Image, ImageFilter
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from vidyam_ai.domain import devanagari
from vidyam_ai.infrastructure.extraction import extract

PACK = Path(__file__).parent
FONTS = PACK / "fonts"
CHROME = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")

Mode = Literal["pdf", "krutidev_pdf", "docx", "scan"]


@dataclass(frozen=True)
class Notes:
    file: str
    mode: Mode
    #: Printed number of the first page (a chapter excerpt from a longer book starts mid-way).
    first_page_label: int | None = None

    @property
    def source(self) -> Path:
        return PACK / "texts" / (Path(self.file).stem + ".md")


NOTES = [
    Notes("physics-motion-force-hi.pdf", "pdf"),
    Notes("physics-work-energy-en.pdf", "pdf"),
    Notes("physics-work-energy-hi.pdf", "pdf"),
    Notes("physics-light-krutidev.pdf", "krutidev_pdf"),
    Notes("physics-electricity-en.docx", "docx"),
    Notes("chemistry-acids-bases-salts-scan.pdf", "scan"),
    Notes("chemistry-carbon-compounds-bilingual.pdf", "pdf"),
    Notes("biology-cell-life-processes-hi.pdf", "pdf", first_page_label=41),
]
BOOKLETS = ["science-test-2025-set-a"]


class BuildError(Exception):
    pass


# --- Fonts --------------------------------------------------------------------------------------------------

_FONT_FILES = {
    "deva": "NotoSansDevanagari-Regular.ttf",
    "deva-b": "NotoSansDevanagari-Bold.ttf",
    "latin": "NotoSans-Regular.ttf",
    "latin-b": "NotoSans-Bold.ttf",
    "math": "NotoSansMath-Regular.ttf",
    "math-b": "NotoSansMath-Regular.ttf",
}
_COVERAGE: dict[str, set[int]] = {}
for _name, _file in _FONT_FILES.items():
    _font = TTFont(_name, str(FONTS / _file))
    pdfmetrics.registerFont(_font)
    _COVERAGE[_name] = set(_font.face.charToGlyph)

_ZW = "\N{ZERO WIDTH NON-JOINER}\N{ZERO WIDTH JOINER}"


def _is_devanagari(ch: str) -> bool:
    return "\N{DEVANAGARI SIGN INVERTED CANDRABINDU}" <= ch <= "\N{DEVANAGARI LETTER BBA}" or ch in _ZW


# --- Unicode → Kruti Dev (fixture only; checked by converting back with the engine's converter) -------------

_CONSONANT = re.compile(devanagari._CONSONANT)  # pyright: ignore[reportPrivateUsage]
_SIGNS = devanagari._SIGNS  # pyright: ignore[reportPrivateUsage]
_VIRAMA = "\N{DEVANAGARI SIGN VIRAMA}"
_SIGN_I = "\N{DEVANAGARI VOWEL SIGN I}"
_RA = "\N{DEVANAGARI LETTER RA}"


def _inverse_table() -> dict[str, str]:
    inverse: dict[str, str] = {}
    for legacy, _ in devanagari._KRUTIDEV:  # pyright: ignore[reportPrivateUsage]
        unicode = devanagari.krutidev_to_unicode(legacy)
        if unicode and unicode != legacy and unicode not in inverse:
            inverse[unicode] = legacy
    for code in "dfhijklmnopqrstuvwxyzDEFGHIJLNOPQRSTUVY;'\"[]{}?<>.,/\\`~^*+=_&%#@!|":
        unicode = devanagari.krutidev_to_unicode(code)
        if unicode and unicode != code:
            inverse.setdefault(unicode, code)
    return inverse


_INVERSE = _inverse_table()
_LONGEST = max(len(k) for k in _INVERSE)


def _cluster_end(text: str, start: int) -> int:
    """End of the consonant cluster starting at `start` (consonant, then virama + consonant pairs)."""
    match = _CONSONANT.match(text, start)
    if not match:
        return start
    end = match.end()
    while end < len(text) and text[end] == _VIRAMA and (m := _CONSONANT.match(text, end + 1)):
        end = m.end()
    return end


def unicode_to_krutidev(text: str) -> str:
    # Reph: र् at the start of a cluster is typed after the syllable ("कार्य" → "dk;Z").
    i = 0
    while (i := text.find(_RA + _VIRAMA, i)) != -1:
        starts_cluster = i == 0 or text[i - 1] != _VIRAMA
        end = _cluster_end(text, i + 2)
        if starts_cluster and end > i + 2:
            while end < len(text) and text[end] in _SIGNS:
                end += 1
            text = text[:i] + text[i + 2 : end] + "Z" + text[end:]
        i += 1
    # Pre-base ि is typed before its cluster ("कि" → "fd").
    out: list[str] = []
    i = 0
    while i < len(text):
        end = _cluster_end(text, i)
        if end > i and end < len(text) and text[end] == _SIGN_I:
            out.append("f" + text[i:end])
            i = end + 1
        elif end > i:
            out.append(text[i:end])
            i = end
        else:
            out.append(text[i])
            i += 1
    text = "".join(out)
    # Everything else, longest match first.
    encoded: list[str] = []
    i = 0
    while i < len(text):
        for size in range(min(_LONGEST, len(text) - i), 0, -1):
            piece = text[i : i + size]
            if piece in _INVERSE:
                encoded.append(_INVERSE[piece])
                i += size
                break
        else:
            ch = text[i]
            if _is_devanagari(ch) and ch not in "fZ":
                raise BuildError(f"no Kruti Dev code for {ch!r} (U+{ord(ch):04X}) in {text!r}")
            encoded.append(ch)
            i += 1
    result = "".join(encoded)
    return result


# --- Drawing ------------------------------------------------------------------------------------------------

Run = tuple[str, str]  # (font name, text as drawn)


@dataclass
class Style:
    size: float
    leading: float
    bold: bool = False
    indent: float = 0
    space_before: float = 0
    space_after: float = 0


STYLES = {
    "h1": Style(18, 26, bold=True, space_after=8),
    "h2": Style(13.5, 20, bold=True, space_before=6, space_after=2),
    "p": Style(11, 17, space_after=6),
    "li": Style(11, 17, indent=14, space_after=2),
    "question": Style(11, 17, space_before=8, space_after=4),
}


class PageWriter:
    """Lays out wrapped, mixed-script lines on A4 pages and records exactly what was drawn on each page."""

    WIDTH, HEIGHT = A4
    LEFT, RIGHT, TOP, BOTTOM = 56.0, 56.0, 60.0, 64.0

    def __init__(
        self, target: Path | io.BytesIO, *, krutidev: bool = False, page_labels: Iterator[str] | None = None
    ):
        self.canvas = canvas.Canvas(
            target if isinstance(target, io.BytesIO) else str(target), pagesize=A4, invariant=True
        )
        self.krutidev = krutidev
        self.page_labels = page_labels
        self.pages: list[list[str]] = [[]]
        self.y = self.HEIGHT - self.TOP

    # Fonts per character
    def _font(self, ch: str, bold: bool) -> str | None:
        if ch.isspace():
            return None
        if self.krutidev:
            if _is_devanagari(ch) or ch in "।॥":
                return "Helvetica-Bold" if bold else "Helvetica"  # renamed to KrutiDev1 on save
            latin = "Times-Bold" if bold else "Times-Roman"
            try:
                ch.encode("cp1252")
            except UnicodeEncodeError:
                raise BuildError(f"{ch!r} can't be drawn in a Kruti Dev document; use plain ASCII") from None
            if ch.isalpha():
                return latin
            # Punctuation and digits join the text around them, unless Kruti Dev would read them as a letter
            # (":" is रू there): then they stay in the Latin font.
            neutral = devanagari.krutidev_to_unicode(ch) == ch or ch in _INVERSE
            return None if neutral else latin
        suffix = "-b" if bold else ""
        if _is_devanagari(ch) or ch in "।॥":
            return "deva" + suffix
        for family in ("latin", "math"):
            if ord(ch) in _COVERAGE[family + suffix]:
                return family + suffix
        raise BuildError(f"no font has {ch!r} (U+{ord(ch):04X})")

    def runs(self, word: str, bold: bool) -> list[Run]:
        """Split a word into same-font runs; digits and punctuation join the run around them."""
        fonts = [self._font(ch, bold) for ch in word]
        default = next(
            (f for f in fonts if f), "Times-Roman" if self.krutidev else ("latin-b" if bold else "latin")
        )
        resolved: list[str] = []
        for f in fonts:
            resolved.append(f or (resolved[-1] if resolved else default))
        runs: list[Run] = []
        for ch, font in zip(word, resolved, strict=True):
            if runs and runs[-1][0] == font:
                runs[-1] = (font, runs[-1][1] + ch)
            else:
                runs.append((font, ch))
        if self.krutidev:
            runs = [(f, unicode_to_krutidev(t) if f.startswith("Helvetica") else t) for f, t in runs]
        return runs

    def _width(self, runs: list[Run], size: float) -> float:
        return sum(pdfmetrics.stringWidth(text, font, size) for font, text in runs)

    def lines(self, text: str, style: Style) -> list[list[tuple[str, list[Run]]]]:
        """Words wrapped into lines; each word keeps its text and the runs that draw it."""
        width = self.WIDTH - self.LEFT - self.RIGHT - style.indent
        lines: list[list[tuple[str, list[Run]]]] = []
        current: list[tuple[str, list[Run]]] = []
        used = 0.0
        for word in text.split():
            runs = self.runs(word, style.bold)
            w = self._width(runs, style.size)
            space = pdfmetrics.stringWidth(" ", runs[-1][0], style.size)
            if current and used + space + w > width:
                lines.append(current)
                current, used = [], 0.0
            used += (space if current else 0) + w
            current.append((word, runs))
        if current:
            lines.append(current)
        return lines

    def height(self, text: str, style: Style) -> float:
        return style.space_before + len(self.lines(text, style)) * style.leading + style.space_after

    def room(self) -> float:
        return self.y - self.BOTTOM

    def block(self, text: str, style: Style, *, prefix: str = "") -> None:
        self.y -= style.space_before
        for n, line in enumerate(self.lines(prefix + text if prefix else text, style)):
            if self.y - style.leading < self.BOTTOM - 4:
                raise BuildError(f"page {len(self.pages)} overflows; move text to the next page")
            self.y -= style.leading
            x = self.LEFT + (style.indent if n or not prefix else style.indent - 10)
            # One string per font change: PDFium drops spaces between separately drawn pieces of Hindi.
            merged: list[Run] = []
            for _, runs in line:
                if merged:
                    merged[-1] = (merged[-1][0], merged[-1][1] + " ")
                for font, part in runs:
                    if merged and merged[-1][0] == font:
                        merged[-1] = (font, merged[-1][1] + part)
                    else:
                        merged.append((font, part))
            for font, part in merged:
                self.canvas.setFont(font, style.size)
                self.canvas.drawString(x, self.y, part)
                x += pdfmetrics.stringWidth(part, font, style.size)
            self.pages[-1].append(" ".join(word for word, _ in line))
        self.y -= style.space_after

    def new_page(self) -> None:
        self._footer()
        self.canvas.showPage()
        self.pages.append([])
        self.y = self.HEIGHT - self.TOP

    def _footer(self) -> None:
        if self.page_labels is None:
            return
        label = next(self.page_labels)
        font = "Times-Roman" if self.krutidev else "latin"
        self.canvas.setFont(font, 9.5)
        self.canvas.drawCentredString(self.WIDTH / 2, 34, label)
        self.pages[-1].append(label)

    def save(self) -> list[str]:
        self._footer()
        self.canvas.save()
        return [" ".join(page) for page in self.pages]


# --- Notes (texts/*.md) -------------------------------------------------------------------------------------

Block = tuple[str, str]  # (style, text)
PAGE_BREAK = "<!-- page -->"
_MARKERS = (("## ", "h2"), ("# ", "h1"), ("- ", "li"))


def parse_notes(markdown: str) -> list[list[Block]]:
    """`# chapter`, `## section`, `- bullet`, paragraphs separated by blank lines, `<!-- page -->` between
    pages."""
    pages: list[list[Block]] = []
    for raw_page in unicodedata.normalize("NFC", markdown).split(PAGE_BREAK):
        blocks: list[Block] = []
        paragraph: list[str] = []
        for line in [*raw_page.splitlines(), ""]:
            line = line.strip()
            starts = next((style for marker, style in _MARKERS if line.startswith(marker)), None)
            if paragraph and (not line or starts):
                blocks.append(("p", " ".join(paragraph)))
                paragraph = []
            if starts:
                blocks.append((starts, line.split(" ", 1)[1].strip()))
            elif line:
                paragraph.append(line)
        if blocks:
            pages.append(blocks)
    return pages


def build_notes_pdf(notes: Notes, out: Path) -> list[str]:
    pages = parse_notes(notes.source.read_text())
    labels = (str(n) for n in range(notes.first_page_label or 1, 10_000)) if notes.first_page_label else None
    buffer = io.BytesIO()
    writer = PageWriter(buffer, krutidev=notes.mode == "krutidev_pdf", page_labels=labels)
    for n, blocks in enumerate(pages):
        if n:
            writer.new_page()
        for style, text in blocks:
            try:
                writer.block(text, STYLES[style], prefix="• " if style == "li" else "")
            except BuildError as error:
                raise BuildError(f"{notes.source.name}, page {n + 1}: {error}") from error
    expected = writer.save()
    data = buffer.getvalue()
    if notes.mode == "krutidev_pdf":
        # Same length as "Helvetica", so byte offsets stay valid; the extractor sees a Kruti Dev font.
        data = data.replace(b"/BaseFont /Helvetica", b"/BaseFont /KrutiDev1")
    out.write_bytes(data)
    return expected


def build_notes_docx(notes: Notes, out: Path) -> list[str]:
    document = Document()
    expected: list[str] = []
    for n, blocks in enumerate(parse_notes(notes.source.read_text())):
        if n:
            document.paragraphs[-1].add_run().add_break(WD_BREAK.PAGE)
        for style, text in blocks:
            if style == "h1":
                document.add_heading(text, level=1)
            elif style == "h2":
                document.add_heading(text, level=2)
            elif style == "li":
                document.add_paragraph(text, style="List Bullet")
            else:
                document.add_paragraph(text)
            expected.append(text)
    document.core_properties.created = document.core_properties.modified = datetime(2025, 7, 1)
    document.save(str(out))
    return [" ".join(expected)]


_SCAN_HTML = """<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Deva; src: url("{fonts}/NotoSansDevanagari-Regular.ttf"); }}
@font-face {{ font-family: Deva; font-weight: bold; src: url("{fonts}/NotoSansDevanagari-Bold.ttf"); }}
@font-face {{ font-family: Latin; src: url("{fonts}/NotoSans-Regular.ttf"); }}
@font-face {{ font-family: Latin; font-weight: bold; src: url("{fonts}/NotoSans-Bold.ttf"); }}
html, body {{ margin: 0; background: #fbfaf6; }}
body {{ width: 1240px; height: 1754px; box-sizing: border-box; padding: 120px 118px; font-family: Latin, Deva;
       font-size: 23px; line-height: 1.55; color: #1d1d1d; }}
h1 {{ font-size: 38px; margin: 0 0 18px; }} h2 {{ font-size: 28px; margin: 20px 0 6px; }}
p {{ margin: 0 0 12px; }} li {{ margin: 0 0 4px; }}
</style></head><body>{body}</body></html>"""


def _html(blocks: list[Block]) -> str:
    import html

    parts: list[str] = []
    in_list = False
    for style, text in blocks:
        if style == "li" and not in_list:
            parts.append("<ul>")
            in_list = True
        if style != "li" and in_list:
            parts.append("</ul>")
            in_list = False
        tag = {"h1": "h1", "h2": "h2", "li": "li"}.get(style, "p")
        parts.append(f"<{tag}>{html.escape(text)}</{tag}>")
    if in_list:
        parts.append("</ul>")
    return "".join(parts)


def build_scan(notes: Notes, out: Path) -> list[str]:
    """Photograph-like pages: rendered by Chrome, then tilted, blurred and noised, with no text layer."""
    if not CHROME.exists():
        raise BuildError("the scan is rendered with Google Chrome, which was not found")
    pages = parse_notes(notes.source.read_text())
    layout = PageWriter(io.BytesIO())  # the scan holds about as much as a printed page: check it fits
    for n, blocks in enumerate(pages):
        if n:
            layout.new_page()
        for style, text in blocks:
            try:
                layout.block(text, STYLES[style], prefix="• " if style == "li" else "")
            except BuildError as error:
                raise BuildError(f"{notes.source.name}, page {n + 1}: {error}") from error
    rng = random.Random(notes.file)
    pdf = canvas.Canvas(str(out), pagesize=A4, invariant=True)
    with tempfile.TemporaryDirectory() as tmp:
        for n, blocks in enumerate(pages):
            html_path = Path(tmp) / f"page-{n}.html"
            png_path = Path(tmp) / f"page-{n}.png"
            html_path.write_text(_SCAN_HTML.format(fonts=FONTS.resolve().as_uri(), body=_html(blocks)))
            subprocess.run(
                [
                    str(CHROME),
                    "--headless=new",
                    "--disable-gpu",
                    "--hide-scrollbars",
                    "--force-device-scale-factor=1",
                    "--window-size=1240,1754",
                    f"--screenshot={png_path}",
                    html_path.as_uri(),
                ],
                check=True,
                capture_output=True,
                timeout=60,
            )
            image = Image.open(png_path).convert("L")
            image = image.rotate(rng.uniform(-0.8, 0.8), resample=Image.Resampling.BICUBIC, fillcolor=245)
            image = image.filter(ImageFilter.GaussianBlur(0.6))
            noise = Image.effect_noise(image.size, 14)
            image = Image.blend(image, noise, 0.06)
            jpeg = io.BytesIO()
            image.save(jpeg, "JPEG", quality=72)
            jpeg.seek(0)
            width, height = A4
            pdf.drawImage(ImageReader(jpeg), 0, 0, width=width, height=height)
            pdf.showPage()
    pdf.save()
    return [" ".join(text for _, text in blocks) for blocks in pages]


# --- Question booklets --------------------------------------------------------------------------------------


def load_questions() -> dict[str, dict[str, Any]]:
    bank: dict[str, dict[str, Any]] = {}
    for path in sorted((PACK / "questions").glob("*.json")):
        for question in json.loads(path.read_text()):
            if question["ref"] in bank:
                raise BuildError(f"duplicate question ref {question['ref']} in {path.name}")
            bank[question["ref"]] = question
    return bank


def build_booklet(name: str, out: Path, key_out: Path) -> tuple[list[str], list[str]]:
    spec = json.loads((PACK / "texts" / f"{name}.json").read_text())
    bank = load_questions()
    set_code = spec["setCode"]
    labels = (f"Set {set_code} · {n}" for n in range(1, 1000))
    buffer = io.BytesIO()
    writer = PageWriter(buffer, page_labels=labels)

    writer.block(spec["title"]["hi"], STYLES["h1"])
    writer.block(spec["title"]["en"], STYLES["h2"])
    writer.block(
        f"समय / Time: {spec['durationMinutes']} मिनट / minutes · पूर्णांक / Maximum marks: {spec['maxMarks']} · "
        f"पुस्तिका सेट / Booklet set: {set_code}",
        STYLES["p"],
    )
    writer.block("निर्देश / Instructions", STYLES["h2"])
    for line in spec["instructions"]["hi"]:
        writer.block(line, STYLES["li"], prefix="• ")
    for line in spec["instructions"]["en"]:
        writer.block(line, STYLES["li"], prefix="• ")

    key: list[tuple[int, str]] = []
    for number, ref in enumerate(spec["questions"], start=1):
        question = bank.get(ref)
        if question is None:
            raise BuildError(f"{name}: unknown question {ref}")
        hi, en = question["content"]["hi"], question["content"]["en"]
        if not hi or not en or not hi["options"]:
            raise BuildError(f"{name}: {ref} needs Hindi, English and options to go in a bilingual booklet")
        lines: list[tuple[str, Style, str]] = [
            (hi["stem"], STYLES["question"], f"{number}. "),
            (en["stem"], STYLES["p"], ""),
        ]
        for hi_option, en_option in zip(hi["options"], en["options"], strict=True):
            lines.append(
                (f"({hi_option['key']}) {hi_option['text']} / {en_option['text']}", STYLES["li"], "")
            )
        needed = sum(writer.height(prefix + text, style) for text, style, prefix in lines)
        if needed > writer.room():
            writer.new_page()
        for text, style, prefix in lines:
            writer.block(prefix + text, style)
        key.append((number, ",".join(question["answer"]["keys"])))
    expected = writer.save()
    out.write_bytes(buffer.getvalue())

    key_writer = PageWriter(key_out)
    key_writer.block(f"उत्तर कुंजी / Answer key — {spec['title']['en']}", STYLES["h1"])
    key_writer.block(f"पुस्तिका सेट / Booklet set: {set_code} · अंतिम / Final", STYLES["p"])
    for start in range(0, len(key), 5):
        row = key[start : start + 5]
        key_writer.block("    ".join(f"{n}. {answer}" for n, answer in row), STYLES["p"])
    return expected, key_writer.save()


# --- Read back ----------------------------------------------------------------------------------------------


def _norm(text: str) -> str:
    return " ".join(unicodedata.normalize("NFC", text).split())


def verify(path: Path, expected: list[str], *, scanned: bool = False) -> None:
    mime = (
        "application/pdf"
        if path.suffix == ".pdf"
        else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    readings = extract(str(path), mime)
    if scanned:
        if not all(r.needs_ocr for r in readings) or len(readings) != len(expected):
            raise BuildError(f"{path.name}: every page should need OCR")
        return
    got = [_norm(r.text) for r in readings]
    want = [_norm(t) for t in expected]
    if path.suffix == ".docx":
        got, want = [" ".join(got)], [" ".join(want)]
    if len(got) != len(want):
        raise BuildError(f"{path.name}: {len(got)} pages read back, {len(want)} drawn")
    for n, (g, w) in enumerate(zip(got, want, strict=True), start=1):
        if g != w:
            at = next((i for i, (a, b) in enumerate(zip(g, w, strict=False)) if a != b), min(len(g), len(w)))
            raise BuildError(
                f"{path.name} page {n} reads back differently at {at}:\n"
                f"  drawn: …{w[max(0, at - 40) : at + 40]}…\n"
                f"  read:  …{g[max(0, at - 40) : at + 40]}…"
            )
    bad = [r.page_no for r in readings if r.needs_ocr]
    if bad:
        raise BuildError(f"{path.name}: pages {bad} were judged unreadable (needs OCR)")


@dataclass
class Report:
    built: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def run(self, name: str, step: Callable[[], None]) -> None:
        try:
            step()
            self.built.append(name)
        except BuildError as error:
            self.errors.append(f"{name}: {error}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--only", help="build only files whose name contains this")
    args = parser.parse_args()
    files = PACK / "files"
    files.mkdir(exist_ok=True)
    report = Report()

    def wanted(name: str) -> bool:
        return args.only is None or args.only in name

    for notes in NOTES:
        if not wanted(notes.file):
            continue
        if not notes.source.exists():
            report.errors.append(f"{notes.file}: source {notes.source.relative_to(PACK)} is missing")
            continue
        out = files / notes.file

        def step(notes: Notes = notes, out: Path = out) -> None:
            if notes.mode == "docx":
                verify(out, build_notes_docx(notes, out))
            elif notes.mode == "scan":
                verify(out, build_scan(notes, out), scanned=True)
            else:
                verify(out, build_notes_pdf(notes, out))

        report.run(notes.file, step)

    for name in BOOKLETS:
        if not wanted(name):
            continue
        out, key_out = files / f"{name}.pdf", files / f"{name}-key.pdf"

        def booklet(name: str = name, out: Path = out, key_out: Path = key_out) -> None:
            pages, key_pages = build_booklet(name, out, key_out)
            verify(out, pages)
            verify(key_out, key_pages)

        report.run(name, booklet)

    for name in report.built:
        print(f"built  {name}")
    for error in report.errors:
        print(f"FAILED {error}", file=sys.stderr)
    return 1 if report.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
