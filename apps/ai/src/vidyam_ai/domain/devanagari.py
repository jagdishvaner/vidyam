"""Devanagari text: converting legacy "Kruti Dev" font text to Unicode, cleaning up extracted Hindi, and
judging whether the result is well-formed. Pure functions; no I/O.

Kruti Dev 010 (and DevLys 010, the same layout) is a keyboard font: Hindi documents typed in it store Latin
characters ("Hkkjr") that the font merely draws as Devanagari ("भारत"). Copying text out of such a PDF or Word
file therefore gives Latin gibberish until it is converted.
"""

# ruff: noqa: RUF001  (this module is about look-alike characters: the Kruti Dev table maps exactly those)
import re
import unicodedata
from typing import Literal

# Kruti Dev 010 / DevLys 010 → Unicode as ordered substitutions: an earlier entry wins, so multi-character
# sequences come before their parts. The character facts match the encoding used by the common open-source
# converters, with one deliberate fix: those map "pkS" to "चै", but p (च) + kS (ौ) is "चौ" ("pkSFkk" = चौथा).
# The pre-base "ि" (f) and the reph "र्" (Z) are not in this table; `krutidev_to_unicode` moves them.
_KRUTIDEV: tuple[tuple[str, str], ...] = (
    ("ñ", "॰"),
    ("Q+Z", "QZ+"),
    ("sas", "sa"),
    ("aa", "a"),
    (")Z", "र्द्ध"),
    ("ZZ", "Z"),
    ("‘", '"'),
    ("’", '"'),
    ("“", "'"),
    ("”", "'"),
    ("å", "०"),
    ("ƒ", "१"),
    ("„", "२"),
    ("…", "३"),
    ("†", "४"),
    ("‡", "५"),
    ("ˆ", "६"),
    ("‰", "७"),
    ("Š", "८"),
    ("‹", "९"),
    ("¶+", "फ़्"),
    ("d+", "क़"),
    ("[+k", "ख़"),
    ("[+", "ख़्"),
    ("x+", "ग़"),
    ("T+", "ज़्"),
    ("t+", "ज़"),
    ("M+", "ड़"),
    ("<+", "ढ़"),
    ("Q+", "फ़"),
    (";+", "य़"),
    ("j+", "ऱ"),
    ("u+", "ऩ"),
    ("Ùk", "त्त"),
    ("Ù", "त्त्"),
    ("ä", "क्त"),
    ("–", "दृ"),
    ("—", "कृ"),
    ("é", "न्न"),
    ("™", "न्न्"),
    ("=kk", "=k"),
    ("f=k", "f="),
    ("à", "ह्न"),
    ("á", "ह्य"),
    ("â", "हृ"),
    ("ã", "ह्म"),
    ("ºz", "ह्र"),
    ("º", "ह्"),
    ("í", "द्द"),
    ("{k", "क्ष"),
    ("{", "क्ष्"),
    ("=", "त्र"),
    ("«", "त्र्"),
    ("Nî", "छ्य"),
    ("Vî", "ट्य"),
    ("Bî", "ठ्य"),
    ("Mî", "ड्य"),
    ("<î", "ढ्य"),
    ("|", "द्य"),
    ("K", "ज्ञ"),
    ("}", "द्व"),
    ("J", "श्र"),
    ("Vª", "ट्र"),
    ("Mª", "ड्र"),
    ("<ªª", "ढ्र"),
    ("<ª", "ढ्र"),
    ("Nª", "छ्र"),
    ("Ø", "क्र"),
    ("Ý", "फ्र"),
    ("nzZ", "र्द्र"),
    ("æ", "द्र"),
    ("ç", "प्र"),
    ("Á", "प्र"),
    ("xz", "ग्र"),
    ("#", "रु"),
    (":", "रू"),
    ("v‚", "ऑ"),
    ("vks", "ओ"),
    ("vkS", "औ"),
    ("vk", "आ"),
    ("v", "अ"),
    ("b±", "ईं"),
    ("Ã", "ई"),
    ("bZ", "ई"),
    ("b", "इ"),
    ("m", "उ"),
    ("Å", "ऊ"),
    (",s", "ऐ"),
    (",", "ए"),
    ("_", "ऋ"),
    ("ô", "क्क"),
    ("d", "क"),
    ("Dk", "क"),
    ("D", "क्"),
    ("[k", "ख"),
    ("[", "ख्"),
    ("x", "ग"),
    ("Xk", "ग"),
    ("X", "ग्"),
    ("Ä", "घ"),
    ("?k", "घ"),
    ("?", "घ्"),
    ("³", "ङ"),
    ("p", "च"),
    ("Pk", "च"),
    ("P", "च्"),
    ("N", "छ"),
    ("t", "ज"),
    ("Tk", "ज"),
    ("T", "ज्"),
    (">", "झ"),
    ("÷", "झ्"),
    ("¥", "ञ"),
    ("ê", "ट्ट"),
    ("ë", "ट्ठ"),
    ("V", "ट"),
    ("B", "ठ"),
    ("ì", "ड्ड"),
    ("ï", "ड्ढ"),
    ("M", "ड"),
    ("<", "ढ"),
    (".k", "ण"),
    (".", "ण्"),
    ("r", "त"),
    ("Rk", "त"),
    ("R", "त्"),
    ("Fk", "थ"),
    ("F", "थ्"),
    (")", "द्ध"),
    ("n", "द"),
    ("/k", "ध"),
    ("èk", "ध"),
    ("/", "ध्"),
    ("Ë", "ध्"),
    ("è", "ध्"),
    ("u", "न"),
    ("Uk", "न"),
    ("U", "न्"),
    ("i", "प"),
    ("Ik", "प"),
    ("I", "प्"),
    ("Q", "फ"),
    ("¶", "फ्"),
    ("c", "ब"),
    ("Ck", "ब"),
    ("C", "ब्"),
    ("Hk", "भ"),
    ("H", "भ्"),
    ("e", "म"),
    ("Ek", "म"),
    ("E", "म्"),
    (";", "य"),
    ("¸", "य्"),
    ("j", "र"),
    ("y", "ल"),
    ("Yk", "ल"),
    ("Y", "ल्"),
    ("G", "ळ"),
    ("o", "व"),
    ("Ok", "व"),
    ("O", "व्"),
    ("'k", "श"),
    ("'", "श्"),
    ('"k', "ष"),
    ('"', "ष्"),
    ("l", "स"),
    ("Lk", "स"),
    ("L", "स्"),
    ("g", "ह"),
    ("È", "ीं"),
    ("z", "्र"),
    ("Ì", "द्द"),
    ("Í", "ट्ट"),
    ("Î", "ट्ठ"),
    ("Ï", "ड्ड"),
    ("Ñ", "कृ"),
    ("Ò", "भ"),
    ("Ó", "्य"),
    ("Ô", "ड्ढ"),
    ("Ö", "झ्"),
    ("Ük", "श"),
    ("Ü", "श्"),
    ("‚", "ॉ"),
    ("ks", "ो"),
    ("kS", "ौ"),
    ("k", "ा"),
    ("h", "ी"),
    ("q", "ु"),
    ("w", "ू"),
    ("`", "ृ"),
    ("s", "े"),
    ("S", "ै"),
    ("a", "ं"),
    ("¡", "ँ"),
    ("%", "ः"),
    ("W", "ॅ"),
    ("•", "ऽ"),
    ("·", "ऽ"),
    ("∙", "ऽ"),
    ("~j", "्र"),
    ("~", "्"),
    ("\\", "?"),
    ("+", "़"),
    ("^", "‘"),
    ("*", "’"),
    ("Þ", "“"),
    ("ß", "”"),
    ("(", ";"),
    ("¼", "("),
    ("½", ")"),
    ("¿", "{"),
    ("À", "}"),
    ("¾", "="),
    ("A", "।"),
    ("-", "."),
    ("&", "-"),
    ("Œ", "॰"),
    ("]", ","),
    ("~ ", "् "),
    ("@", "/"),
)

_NUKTA = "\N{DEVANAGARI SIGN NUKTA}"
_VIRAMA = "\N{DEVANAGARI SIGN VIRAMA}"  # halant: joins a consonant to the next one
_SIGN_I = "\N{DEVANAGARI VOWEL SIGN I}"
_REPH = "\N{DEVANAGARI LETTER RA}" + _VIRAMA
_CONSONANT = (
    "[\N{DEVANAGARI LETTER KA}-\N{DEVANAGARI LETTER HA}"
    "\N{DEVANAGARI LETTER QA}-\N{DEVANAGARI LETTER YYA}]" + _NUKTA + "?"
)
_CLUSTER = re.compile(f"{_CONSONANT}(?:{_VIRAMA}{_CONSONANT})*")
# Vowel signs, candrabindu, anusvara and visarga: what can sit between a consonant cluster and a reph.
_SIGNS = frozenset(chr(c) for c in [0x901, 0x902, 0x903, *range(0x93E, 0x94D), 0x962, 0x963])


def krutidev_to_unicode(text: str) -> str:
    """Convert text typed in the Kruti Dev 010 / DevLys 010 font to Unicode Devanagari.

    Only pass text that was actually set in that font: it maps ordinary Latin letters too.
    """
    for legacy, unicode in _KRUTIDEV:
        while legacy in text:  # a replacement can expose a new match ("aaa" → "aa" → "a")
            text = text.replace(legacy, unicode)
    # Combined glyphs that carry a pre-base ि or a reph, resolved by the moves below.
    text = text.replace("±", "Zं").replace("Æ", "र्f").replace("É", "र्Ç").replace("Ê", "ीZ")
    text = _move_pre_base_i(text)
    return _move_reph(text)


def _move_pre_base_i(text: str) -> str:
    """Kruti Dev stores ि (f) and िं (Ç) before the consonant cluster they follow in Unicode."""
    out: list[str] = []
    i = 0
    while i < len(text):
        char = text[i]
        if char in "fÇ":
            sign = _SIGN_I if char == "f" else _SIGN_I + "\N{DEVANAGARI SIGN ANUSVARA}"
            match = _CLUSTER.match(text, i + 1)
            if match:
                out.append(match.group() + sign)
                i = match.end()
                continue
            out.append(sign)  # no consonant follows: keep the sign where it stood
        else:
            out.append(char)
        i += 1
    return "".join(out)


def _cluster_start(text: str, end: int) -> int | None:
    """Start of the consonant cluster ending just before `end` (skipping any signs on it), or None."""
    pos = end
    while pos > 0 and text[pos - 1] in _SIGNS:
        pos -= 1
    match = None
    for start in range(max(0, pos - 12), pos):  # clusters are short; try the longest first
        candidate = _CLUSTER.fullmatch(text, start, pos)
        if candidate and (start == 0 or text[start - 1] != _VIRAMA):
            match = start
            break
    return match


def _move_reph(text: str) -> str:
    """Kruti Dev stores the reph (Z) after the syllable it sits on; in Unicode, र् precedes the whole cluster
    ("eR;Z" → मर्त्य, not मत्र्य)."""
    while (z := text.find("Z")) != -1:
        start = _cluster_start(text, z)
        if start is None:  # nothing to attach to: leave a bare र् in place
            start = z
        text = text[:start] + _REPH + text[start:z] + text[z + 1 :]
    return text


LegacyEncoding = Literal["krutidev", "unsupported"]

_KRUTIDEV_FONTS = ("krutidev", "devlys")
# Other legacy Hindi fonts with their own layouts. Text set in them goes to OCR instead of a guessed mapping.
_OTHER_LEGACY_FONTS = ("chanakya", "walkman", "shusha", "agra", "aalekh", "akruti", "kundli", "shivaji")


def legacy_encoding(font_name: str) -> LegacyEncoding | None:
    """Classify a font by name. PDF subsets are prefixed ("ABCDEF+KrutiDev010"); spacing and case vary."""
    name = re.sub(r"^[A-Z]{6}\+", "", font_name).lower()
    name = re.sub(r"[\s_\-]", "", name)
    if any(family in name for family in _KRUTIDEV_FONTS):
        return "krutidev"
    if any(family in name for family in _OTHER_LEGACY_FONTS):
        return "unsupported"
    return None


# The commonest Hindi words as they look when typed in Kruti Dev: का के की है में और को से पर भी यह वह कि नहीं तथा
_KRUTIDEV_MARKERS = frozenset(
    [
        "dk",
        "ds",
        "dh",
        "gS",
        "esa",
        "vkSj",
        "dks",
        "ls",
        "ij",
        "Hkh",
        ";g",
        "og",
        "fd",
        "ugha",
        "rFkk",
        "gSa",
        "Fkk",
        "Fks",
        "x;k",
        "fd;k",
        "tkrk",
    ]
)


def looks_like_krutidev(text: str) -> bool:
    """For text whose font name is unknown (plain .txt files, renamed fonts): Kruti Dev Hindi is full of
    tokens like "dk", "gS" and "esa", which almost never occur in English."""
    tokens = re.findall(r"[^\s.,!?()\[\]\"']+", text)
    if len(tokens) < 12:
        return False
    return sum(token in _KRUTIDEV_MARKERS for token in tokens) / len(tokens) >= 0.05


_INVISIBLE = dict.fromkeys(
    map(
        ord,
        "\N{SOFT HYPHEN}\N{ZERO WIDTH NO-BREAK SPACE}\N{ZERO WIDTH SPACE}\N{WORD JOINER}",
    )
)
_DEVANAGARI = "\N{DEVANAGARI SIGN INVERTED CANDRABINDU}-\N{DEVANAGARI LETTER BBA}"
_VISUAL_I = re.compile(f"(?<![{_DEVANAGARI}]){_SIGN_I}({_CLUSTER.pattern})")


def clean_text(text: str) -> str:
    """Normalize extracted text for storage and display: Unicode NFC, no invisible junk, consistent spacing,
    and the commonest PDF extraction defect in Hindi repaired (ि copied in visual order, before its
    consonant)."""
    text = unicodedata.normalize("NFC", text).translate(_INVISIBLE)
    text = _VISUAL_I.sub(lambda m: m.group(1) + _SIGN_I, text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub("[ \t\N{NO-BREAK SPACE}]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


_HINDI_WORD = re.compile(f"[A-Za-z{_DEVANAGARI}]*[{_DEVANAGARI}][A-Za-z{_DEVANAGARI}]*")
_VOWEL_SIGNS = "\N{DEVANAGARI VOWEL SIGN AA}-\N{DEVANAGARI VOWEL SIGN AU}"
_MALFORMED = re.compile(
    # starts with a vowel sign, candrabindu/anusvara/visarga or halant
    f"^[{_VOWEL_SIGNS}\N{DEVANAGARI SIGN CANDRABINDU}-\N{DEVANAGARI SIGN VISARGA}{_VIRAMA}]"
    f"|[{_VOWEL_SIGNS}]{{2}}"  # two vowel signs in a row
    f"|{_VIRAMA}[{_VOWEL_SIGNS}]"  # halant followed by a vowel sign
    "|[A-Za-z]"  # Latin left inside a Hindi word: unconverted legacy text
)


def devanagari_quality(text: str) -> float | None:
    """Share of Hindi words that are well-formed, from 0 to 1; None if the text has no Hindi."""
    words = _HINDI_WORD.findall(text)
    if not words:
        return None
    return round(1 - sum(bool(_MALFORMED.search(w)) for w in words) / len(words), 3)


def script_mix(text: str) -> tuple[int, int]:
    """(Devanagari letters, Latin letters)."""
    return len(re.findall(f"[{_DEVANAGARI}]", text)), len(re.findall("[A-Za-z]", text))
