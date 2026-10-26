import pytest
from vidyam_ai.domain.devanagari import (
    clean_text,
    devanagari_quality,
    krutidev_to_unicode,
    legacy_encoding,
    looks_like_krutidev,
)

# Words as typists enter them in Kruti Dev 010, and what they mean. Covers the pre-base ि (f) over single
# consonants and conjuncts, the reph (Z) over single consonants and conjuncts, ligature keys and nukta.
KRUTIDEV_WORDS = {
    "Hkkjr": "भारत",
    "jktLFkku": "राजस्थान",
    "fgUnh": "हिन्दी",
    "f'k{kk": "शिक्षा",
    "iz'u": "प्रश्न",
    "mÙkj": "उत्तर",
    "dkSu": "कौन",
    "lafo/kku": "संविधान",
    "xf.kr": "गणित",
    "foKku": "विज्ञान",
    "HkkSfrdh": "भौतिकी",
    "jlk;u": "रसायन",
    "ijh{kk": "परीक्षा",
    "esa": "में",
    "gS": "है",
    "vkSj": "और",
    "'kCn": "शब्द",
    "fØ;k": "क्रिया",
    "f}rh;": "द्वितीय",
    "fLFkfr": "स्थिति",  # ि after a whole conjunct
    "izfr'kr": "प्रतिशत",
    "dk;Z": "कार्य",
    "/keZ": "धर्म",
    "iwoZ": "पूर्व",
    "ikoZrh": "पार्वती",
    "dk;ZØe": "कार्यक्रम",
    "dhfrZ": "कीर्ति",  # reph past a vowel sign
    "eR;Z": "मर्त्य",  # reph before a whole conjunct
    "vFkZ'kkL=": "अर्थशास्त्र",
    "pkSFkk": "चौथा",  # common converters wrongly give चैथा
    "pSu": "चैन",
    "lM+d": "सड़क",
    "<+kyw": "ढ़ालू",
}


@pytest.mark.parametrize(("typed", "hindi"), KRUTIDEV_WORDS.items())
def test_krutidev_words_convert_to_unicode(typed: str, hindi: str) -> None:
    assert clean_text(krutidev_to_unicode(typed)) == hindi


def test_a_krutidev_sentence_keeps_its_punctuation_and_digits() -> None:
    typed = "Hkkjr dk lafo/kku 26 tuojh 1950 dks ykxw gqvkA D;k ;g lgh gS\\"
    assert krutidev_to_unicode(typed) == "भारत का संविधान 26 जनवरी 1950 को लागू हुआ। क्या यह सही है?"


@pytest.mark.parametrize(
    ("font", "encoding"),
    [
        ("KrutiDev010", "krutidev"),
        ("ABCDEF+Kruti-Dev-010", "krutidev"),
        ("DevLys 010", "krutidev"),
        ("Walkman-Chanakya905", "unsupported"),
        ("NotoSansDevanagari-Regular", None),
        ("Mangal", None),
        ("TimesNewRomanPSMT", None),
    ],
)
def test_fonts_are_classified_by_name(font: str, encoding: str | None) -> None:
    assert legacy_encoding(font) == encoding


def test_krutidev_text_is_recognized_without_a_font_name() -> None:
    hindi = "Hkkjr dk lafo/kku 26 tuojh 1950 dks ykxw gqvk Fkk vkSj ;g fo'o dk lcls cM+k fyf[kr lafo/kku gS"
    english = "The Constitution of India came into force on 26 January 1950 and is the longest written one."
    assert looks_like_krutidev(hindi)
    assert not looks_like_krutidev(english)


def test_clean_text_repairs_visual_order_i_and_normalizes_spacing() -> None:
    # ि copied before its consonant, as some PDFs store it; a soft hyphen; ragged spacing.
    assert (
        clean_text("\N{DEVANAGARI VOWEL SIGN I}कताब  में\N{SOFT HYPHEN}  \r\n\r\n\r\nपाठ ") == "किताब में\n\nपाठ"
    )


def test_quality_flags_malformed_hindi() -> None:
    assert devanagari_quality("भारत का संविधान") == 1.0
    assert devanagari_quality("\N{DEVANAGARI VOWEL SIGN AA}रत dk संविधान") == pytest.approx(0.5)
    assert devanagari_quality("only English here") is None
