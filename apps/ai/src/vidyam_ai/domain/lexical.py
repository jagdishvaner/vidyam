"""Keyword forms of text for BM25 search (plan v3 §5, step 18), shared by indexing and queries. Pure; no I/O.

Two forms are kept for every chunk, question and query, and the same functions make both sides, so they match:

- `lex`: Hindi and English, normalized. Spelling variants that mean the same word become one form: the
  nasal half-letter and the anusvara (हिन्दी, हिंदी), chandrabindu and anusvara (हँसना, हंसना), nukta
  letters and their plain ones (ज़मीन, जमीन), Devanagari and ASCII digits. Punctuation splits words.
- `lex_roman`: everything in Latin letters, folded to a rough sound key. Teachers type Hinglish ("newton ka
  teesra niyam", "twaran"), so Hindi is romanized the way it is spoken (inherent vowels dropped where speakers
  drop them: गति → gati, नियम → niyam), and both sides are folded so common spelling differences disappear:
  long and short vowels (ee/i, oo/u, aa/a), aspiration (th/t, dh/d), sh/s, w/v, eh/ah, doubled letters, a
  final "a" (teesra, tisra → tisr).

Changing either form changes what is indexed; re-index after a change (from the Parquet copies, no
re-embedding).
"""

import re
import unicodedata

_NUKTA = "\N{DEVANAGARI SIGN NUKTA}"
_VIRAMA = "\N{DEVANAGARI SIGN VIRAMA}"
_ANUSVARA = "\N{DEVANAGARI SIGN ANUSVARA}"
_VISARGA = "\N{DEVANAGARI SIGN VISARGA}"
_CHANDRABINDU = "\N{DEVANAGARI SIGN CANDRABINDU}"

# A nasal half-letter before a consonant of its own class is the anusvara written out: ङ्क, ञ्च, ण्ड, न्त, म्ब.
_NASAL_CLUSTER = re.compile(
    f"(?:ङ{_VIRAMA}(?=[क-घ])|ञ{_VIRAMA}(?=[च-झ])|ण{_VIRAMA}(?=[ट-ढ])|न{_VIRAMA}(?=[त-ध])|म{_VIRAMA}(?=[प-भ]))"
)
_WORD = re.compile("[0-9A-Za-zÀ-ɏऀ-ॣ०-ॿ]+")
_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")
_INVISIBLE = dict.fromkeys(map(ord, "​‌‍­﻿"))
_CANDRA = str.maketrans({"ॅ": "े", "ॉ": "ो", "ऍ": "ए", "ऑ": "ओ"})


def normalize(text: str) -> str:
    """The `lex` form: one spelling per word, lowercase Latin, words separated by single spaces."""
    # NFKD also turns superscripts and other compatibility forms into plain ones (m/s² → m s2).
    text = unicodedata.normalize("NFKD", text.translate(_INVISIBLE)).replace(_NUKTA, "")
    text = unicodedata.normalize("NFC", text).translate(_DIGITS).translate(_CANDRA)
    text = text.replace(_CHANDRABINDU, _ANUSVARA)
    text = _NASAL_CLUSTER.sub(_ANUSVARA, text)
    return " ".join(_WORD.findall(text.casefold()))


# --- Romanizing ------------------------------------------------------------------------------------------

_CONSONANTS = {
    "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n",
    "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
    "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
    "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
    "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
    "य": "y", "र": "r", "ल": "l", "ळ": "l", "व": "v",
    "श": "sh", "ष": "sh", "स": "s", "ह": "h",
}  # fmt: skip
_VOWELS = {
    "अ": "a", "आ": "a", "इ": "i", "ई": "i", "उ": "u", "ऊ": "u", "ऋ": "ri",
    "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au",
}  # fmt: skip
_SIGNS = {
    "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "ृ": "ri",
    "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
}  # fmt: skip

Unit = tuple[str, str]  # (Latin, "C" consonant | "V" vowel | "S" inherent vowel | "N" nasal etc. | "X" other)


def _units(word: str) -> list[Unit]:
    units: list[Unit] = []
    pending = False  # the last consonant still carries its inherent "a"
    for char in word:
        if char in _CONSONANTS:
            if pending:
                units.append(("a", "S"))
            units.append((_CONSONANTS[char], "C"))
            pending = True
            continue
        if char in _SIGNS:
            units.append((_SIGNS[char], "V"))
        elif char == _VIRAMA:
            pass
        elif char in _VOWELS:
            if pending:
                units.append(("a", "S"))
            units.append((_VOWELS[char], "V"))
        elif char in (_ANUSVARA, _VISARGA):
            if pending:
                units.append(("a", "S"))
            units.append(("n" if char == _ANUSVARA else "h", "N"))
        else:
            if pending:
                units.append(("a", "S"))
            units.append((char, "X"))
        pending = False
    if pending:
        units.append(("a", "S"))
    return units


def _drop_schwas(units: list[Unit]) -> list[Unit]:
    """Where Hindi speakers drop the inherent vowel: at the end of a word (बल → bal) and between a vowel and a
    consonant that has a vowel of its own (समझना → samajhna, तीसरा → tisra)."""
    syllables = sum(kind in ("V", "S") for _, kind in units)
    keep = [True] * len(units)
    if units and units[-1][1] == "S" and syllables > 1:
        keep[-1] = False
    for i in range(len(units) - 2, 1, -1):
        if units[i][1] != "S" or not keep[i]:
            continue
        before_vowel = units[i - 2][1] in ("V", "S") and keep[i - 2] and units[i - 1][1] == "C"
        after = units[i + 1 : i + 3]
        # the next consonant keeps a vowel: its own, or an inherent one that stays (अपवर्तन → apvartan)
        followed = (
            len(after) == 2
            and after[0][1] == "C"
            and (after[1][1] == "V" or (after[1][1] == "S" and keep[i + 2]))
        )
        if before_vowel and followed:
            keep[i] = False
    return [unit for unit, kept in zip(units, keep, strict=True) if kept]


def romanize(word: str) -> str:
    """One word of Devanagari in Latin letters as it is spoken (Latin and digits pass through)."""
    word = unicodedata.normalize("NFC", unicodedata.normalize("NFD", word).replace(_NUKTA, ""))
    if not re.search("[ऀ-ॿ]", word):
        return word
    return "".join(text for text, _ in _drop_schwas(_units(word)))


_FOLDS = [
    ("chh", "ch"), ("sh", "s"), ("ph", "f"), ("kh", "k"), ("gh", "g"), ("jh", "j"),
    ("th", "t"), ("dh", "d"), ("bh", "b"), ("w", "v"), ("z", "j"), ("q", "k"),
    ("ee", "i"), ("ii", "i"), ("oo", "u"), ("uu", "u"), ("aa", "a"),
    ("eh", "ah"),  # Hinglish writes "pehchan", "kehna" for पहचान, कहना
    # English words, as Hindi writes them: रॉकेट rocket, यीस्ट yeast, सेल cell, कॉन्वेक्स convex
    ("ck", "k"), ("ea", "i"), ("x", "ks"),
]  # fmt: skip
_SOFT_C = re.compile(r"c(?!h)(?=[eiy])")
_HARD_C = re.compile(r"c(?!h)")


def fold(word: str) -> str:
    """A rough sound key of a Latin word, so Hinglish spellings of the same word meet."""
    word = "".join(c for c in unicodedata.normalize("NFKD", word.casefold()) if c.isascii() and c.isalnum())
    for old, new in _FOLDS:
        word = word.replace(old, new)
    word = _HARD_C.sub("k", _SOFT_C.sub("s", word))
    word = re.sub(r"(.)\1+", r"\1", word)
    return re.sub(r"(?<=[^aeiou\d])a$", "", word) if len(word) > 2 else word


def romanized(text: str) -> str:
    """The `lex_roman` form: every word romanized and folded."""
    return " ".join(key for word in normalize(text).split() if (key := fold(romanize(word))))


def lexical(text: str) -> tuple[str, str]:
    """Both keyword forms of a text: (`lex`, `lex_roman`)."""
    return normalize(text), romanized(text)
