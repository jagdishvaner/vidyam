from pathlib import Path

import pytest
from vidyam_ai.domain.documents import TextRun, classify_fonts, read_page
from vidyam_ai.infrastructure.extraction import DOCX, UnsupportedDocument, extract

from tests.fixtures.documents import krutidev_docx, krutidev_pdf, scanned_pdf, unicode_pdf

PDF = "application/pdf"


def test_unicode_hindi_pdf_reads_page_by_page(tmp_path: Path) -> None:
    path = unicode_pdf(
        tmp_path / "book.pdf",
        [
            ["भारत का संविधान 26 जनवरी 1950 को लागू हुआ।", "Constitution of India came into force."],
            ["मौलिक अधिकार"],
        ],
    )
    first, second = extract(str(path), PDF)
    assert (first.page_no, first.method, first.needs_ocr) == (1, "text_layer", False)
    assert first.text == "भारत का संविधान 26 जनवरी 1950 को लागू हुआ।\nConstitution of India came into force."
    assert second.page_no == 2
    assert second.note == "blank page"  # too little text to count, but not a scan either


def test_krutidev_pdf_is_converted_while_english_is_left_alone(tmp_path: Path) -> None:
    path = krutidev_pdf(
        tmp_path / "notes.pdf",
        ["Hkkjr dk lafo/kku 26 tuojh 1950 dks ykxw gqvk Fkk", "fgUnh esa iz'u vkSj mÙkj"],
        ["Chapter 1: Constitution of India"],
    )
    [page] = extract(str(path), PDF)
    assert page.method == "legacy_font"
    assert not page.needs_ocr
    assert page.text.splitlines() == [
        "Chapter 1: Constitution of India",
        "भारत का संविधान 26 जनवरी 1950 को लागू हुआ था",
        "हिन्दी में प्रश्न और उत्तर",
    ]


def test_a_scanned_page_waits_for_ocr(tmp_path: Path) -> None:
    [page] = extract(str(scanned_pdf(tmp_path / "scan.pdf")), PDF)
    assert page.needs_ocr
    assert page.text == ""
    assert page.note == "scanned page without a text layer"


def test_krutidev_word_file_is_converted(tmp_path: Path) -> None:
    path = krutidev_docx(tmp_path / "notes.docx", ["Hkkjr dk lafo/kku dk;Z djrk gS"], ["Chapter 1"])
    [page] = extract(str(path), DOCX)
    assert (page.page_no, page.method) == (None, "legacy_font")
    assert page.text == "Chapter 1\nभारत का संविधान कार्य करता है"


def test_krutidev_text_file_is_recognized_without_any_font(tmp_path: Path) -> None:
    path = tmp_path / "transcript.txt"
    text = "Hkkjr dk lafo/kku 26 tuojh 1950 dks ykxw gqvk Fkk vkSj ;g fo'o dk lcls cM+k fyf[kr lafo/kku gS"
    path.write_bytes(text.encode("cp1252"))
    [page] = extract(str(path), "text/plain")
    assert page.method == "legacy_font"
    assert page.text.startswith("भारत का संविधान 26 जनवरी 1950 को लागू हुआ था और यह")


def test_unconvertible_legacy_fonts_and_damaged_hindi_go_to_ocr() -> None:
    chanakya = read_page(
        1, [TextRun("Hkkjr dk lafo/kku" * 3, "Walkman-Chanakya905")], {"Walkman-Chanakya905": "unsupported"}
    )
    assert chanakya.needs_ocr
    assert chanakya.note and "Walkman-Chanakya905" in chanakya.note

    damaged = (
        "\N{DEVANAGARI VOWEL SIGN AA}रत \N{DEVANAGARI VOWEL SIGN E}का \N{DEVANAGARI SIGN VIRAMA}संविधान " * 5
    )
    page = read_page(2, [TextRun(damaged, "Mangal")], classify_fonts({"Mangal": damaged}))
    assert page.needs_ocr
    assert page.note and "damaged" in page.note


def test_unknown_file_types_are_refused(tmp_path: Path) -> None:
    with pytest.raises(UnsupportedDocument):
        extract(str(tmp_path / "old.doc"), "application/msword")
