"""Keyword forms for BM25 (plan v3 §5, step 18): Hindi spelling variants meet, and Hinglish meets Hindi."""

import json

from vidyam_ai.config import REPO_ROOT
from vidyam_ai.domain.lexical import fold, lexical, normalize, romanize, romanized


def test_hindi_spelling_variants_become_one_form() -> None:
    pairs = [
        ("हिन्दी", "हिंदी"),  # nasal half-letter / anusvara
        ("गङ्गा", "गंगा"),
        ("सम्बन्ध", "संबंध"),
        ("हँसना", "हंसना"),  # chandrabindu / anusvara
        ("ज़मीन", "जमीन"),  # nukta
        ("डॉक्टर", "डोक्टर"),  # candra o
        ("कक्षा ९", "कक्षा 9"),  # Devanagari digits
    ]
    for one, other in pairs:
        assert normalize(one) == normalize(other), (one, other)
    assert normalize("न्याय") == "न्याय"  # न् before य is a real cluster, not an anusvara
    assert normalize("त्वरण (Acceleration) का SI मात्रक m/s² है।") == "त्वरण acceleration का si मात्रक m s2 है"


def test_hindi_is_romanized_as_it_is_spoken() -> None:
    spoken = {
        "गति": "gati",
        "बल": "bal",
        "नियम": "niyam",
        "त्वरण": "tvaran",
        "तीसरा": "tisra",
        "समझना": "samajhna",
        "कमला": "kamla",
        "अपवर्तन": "apvartan",
        "परावर्तन": "paravartan",
        "प्रतिक्रिया": "pratikriya",
        "पढ़ाई": "padhai",
    }
    for hindi, latin in spoken.items():
        assert romanize(hindi) == latin, hindi
    assert romanize("newton") == "newton"


def test_hinglish_spellings_meet_the_hindi_words() -> None:
    for typed, hindi in [
        ("teesra", "तीसरा"),
        ("twaran", "त्वरण"),
        ("koshika", "कोशिका"),
        ("pehchan", "पहचान"),
        ("vistapan", "विस्थापन"),
        ("rocket", "रॉकेट"),
        ("yeast", "यीस्ट"),
    ]:
        assert fold(typed) == fold(romanize(normalize(hindi))), (typed, hindi)
    assert lexical("न्यूटन का तीसरा नियम")[1] == romanized("nyutan ka teesra niyam")


def test_most_demo_hinglish_queries_share_a_keyword_with_their_passage() -> None:
    queries = json.loads((REPO_ROOT / "fixtures" / "demo-pack" / "eval" / "retrieval.json").read_text())
    queries = queries["queries"] if isinstance(queries, dict) else queries
    stop = set(romanized("का की के को से में पर है हैं और एक यह कि क्या कैसे").split())
    stop |= set(romanized("ka ki ke kya kaise hai hota hoti se me aur kis kyon kyu").split())
    hinglish = [q for q in queries if q["lang"] == "hinglish"]
    matched = [
        q
        for q in hinglish
        if (
            set(romanized(q["query"]).split())
            & set(romanized(" ".join(e["phrase"] for e in q["expect"])).split())
        )
        - stop
    ]
    assert len(matched) / len(hinglish) >= 0.75  # 13 of 17 when written; the rest is the dense vectors' job
