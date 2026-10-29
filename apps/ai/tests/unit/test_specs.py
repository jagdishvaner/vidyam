"""The draft spec's rules (plan v3 §6–7, ADR 0015): sections from the exam's pattern, defaults, what is
missing, the cards that ask for it, and the review card's spec, availability and estimate."""

from uuid import uuid4

from vidyam_ai.domain.mentions import NodeName, resolve
from vidyam_ai.domain.specs import (
    DIFFICULTY,
    Pattern,
    Wish,
    apply_values,
    availability,
    cards,
    choose_pattern,
    complete,
    merge,
    minutes,
    missing,
    scale,
    split,
    title_for,
    with_defaults,
    work,
)


def section(qtype: str, count: int, marks: float = 1) -> dict[str, object]:
    return {
        "name": {"en": qtype},
        "qtype": qtype,
        "count": count,
        "marksEach": marks,
        "negativeMarks": 0,
        "attemptAny": None,
        "difficultyMix": DIFFICULTY["medium"],
        "scope": [],
    }


RPSC = Pattern(
    uuid4(),
    (section("mcq_single", 120, 2), section("numerical", 30, 2)),
    150,
    DIFFICULTY["medium"],
    "Full paper",
)
CHAPTER_TEST = Pattern(uuid4(), (section("mcq_single", 25, 2),), 30, DIFFICULTY["medium"], "Chapter test")
MOTION, LIGHT = uuid4(), uuid4()


def test_a_pattern_scales_to_the_questions_asked_for() -> None:
    assert [s["count"] for s in scale(RPSC.sections, 50)] == [40, 10]
    assert [s["count"] for s in scale(RPSC.sections, 3)] == [2, 1]
    assert split(7, 3) == [3, 2, 2]


def test_a_request_becomes_a_draft_with_the_exams_pattern_and_the_teachers_languages() -> None:
    wish = Wish(
        kind="question_paper", exam_code="rpsc_2g_p2_science", node_ids=(MOTION,), question_count=50,
        difficulty="hard",
    )  # fmt: skip
    draft = with_defaults(merge({}, wish, RPSC), ["hi", "en"], RPSC)
    assert draft["examCode"] == "rpsc_2g_p2_science" and draft["blueprintId"] == str(RPSC.id)
    assert [(s["qtype"], s["count"]) for s in draft["sections"]] == [("mcq_single", 40), ("numerical", 10)]
    assert all(s["difficultyMix"] == DIFFICULTY["hard"] for s in draft["sections"])
    assert draft["durationMinutes"] == 50  # the pattern's 150 minutes, for a third of its questions
    assert (draft["languages"], draft["layout"], draft["sourcing"]) == (
        ["hi", "en"],
        "hindi_then_english",
        "bank_first",
    )
    assert missing(draft) == (False, False)

    # "only MCQs, Hindi only" changes what was there.
    narrowed = merge(draft, Wish(question_types=("mcq_single",), languages=("hi",)), RPSC)
    assert [(s["qtype"], s["count"]) for s in narrowed["sections"]] == [("mcq_single", 120)]
    assert (narrowed["languages"], narrowed["layout"]) == (["hi"], "single_language")


def test_what_is_missing_is_asked_on_at_most_two_cards() -> None:
    draft = with_defaults(merge({}, Wish(kind="question_paper"), None), ["hi", "en"], None)
    assert missing(draft) == (True, True)
    scope, shape = cards(draft, "t1", scope=True, shape=True, node_suggestions=[MOTION, LIGHT])
    assert scope["purpose"] == "scope" and scope["cardId"] == "scope:t1"
    assert {"key": "taxonomy_nodes", "required": True, "suggested": [str(MOTION), str(LIGHT)]} in scope[
        "fields"
    ]
    assert shape["purpose"] == "shape" and [f["key"] for f in shape["fields"]][:2] == [
        "blueprint",
        "sections",
    ]

    worksheet = with_defaults(merge({}, Wish(kind="worksheet", node_ids=(MOTION,)), None), ["en"], None)
    assert missing(worksheet) == (False, False) and worksheet["sections"][0]["count"] == 20

    notes = with_defaults(merge({}, Wish(kind="notes", node_ids=(LIGHT,)), None), ["hi"], None)
    assert missing(notes) == (False, False)
    assert complete(notes, "Notes: Light") == {
        "kind": "notes", "title": "Notes: Light", "examCode": None, "taxonomyNodeIds": [str(LIGHT)],
        "languages": ["hi"], "depth": "standard", "includeExamples": True, "includePractice": False,
    }  # fmt: skip


def test_a_card_answer_fills_the_draft_without_a_model() -> None:
    draft = with_defaults(merge({}, Wish(kind="question_paper"), RPSC), ["hi", "en"], RPSC)
    answered = apply_values(
        draft, {"taxonomy_nodes": [str(MOTION)], "languages": ["en"], "difficulty_mix": DIFFICULTY["easy"]}
    )
    assert answered["taxonomyNodeIds"] == [str(MOTION)] and answered["layout"] == "single_language"
    assert all(s["difficultyMix"] == DIFFICULTY["easy"] for s in answered["sections"])


def test_the_review_card_shows_what_the_bank_has_and_what_it_costs() -> None:
    draft = with_defaults(
        merge(
            {}, Wish(kind="question_paper", exam_code="x", node_ids=(MOTION, LIGHT), question_count=50), RPSC
        ),
        ["hi", "en"],
        RPSC,
    )
    spec = complete(draft, title_for("question_paper", "RPSC Science", ["Laws of Motion", "Light"], "en"))
    assert spec["title"] == "RPSC Science: Laws of Motion, Light"
    per_node = availability(spec, {str(MOTION): 30}, {str(MOTION): "Laws of Motion"})
    assert per_node == [
        {"nodeId": str(MOTION), "name": "Laws of Motion", "fromBank": 25, "toGenerate": 0},
        {"nodeId": str(LIGHT), "name": str(LIGHT), "fromBank": 0, "toGenerate": 25},
    ]
    assert availability({**spec, "sourcing": "fresh_only"}, {str(MOTION): 30}, {})[0]["fromBank"] == 0
    tasks = work(spec, 25)
    assert set(tasks) == {"generate", "verify_solve", "verify_grounding"}
    assert len(tasks["generate"][0]) == 5 and len(tasks["verify_solve"][0]) == 25  # 5 calls of 5 questions
    assert work(spec, 0) == {} and minutes(spec, 25) > minutes(spec, 0)
    assert title_for("notes", None, ["प्रकाश"], "hi") == "नोट्स: प्रकाश"


def test_names_teachers_type_resolve_to_the_syllabus_in_any_script() -> None:
    laws = NodeName(MOTION, "laws_of_motion", "chapter", ("Laws of Motion", "गति के नियम", "newton ke niyam"))
    line = NodeName(uuid4(), "motion_line", "chapter", ("Motion in a Straight Line", "सरल रेखा में गति"))
    nodes = [laws, line]
    for typed in ("gati ke niyam", "Newton ke niyam", "गति के नियम", "laws of motion"):
        assert resolve(typed, nodes).node == laws.id, typed
    unclear = resolve("motion", nodes)
    assert unclear.node is None and set(unclear.candidates) == {laws.id, line.id}
    assert resolve("photosynthesis", nodes).candidates == ()


def test_the_pattern_fits_the_request() -> None:
    both = [CHAPTER_TEST, RPSC]
    assert choose_pattern(both, kind="question_paper", count=None, nodes=0) == RPSC  # a whole subject
    assert choose_pattern(both, kind="question_paper", count=None, nodes=1) == CHAPTER_TEST  # one chapter
    assert choose_pattern(both, kind="worksheet", count=None, nodes=10) == CHAPTER_TEST
    assert (
        choose_pattern(both, kind="question_paper", count=40, nodes=1) == CHAPTER_TEST
    )  # 25 is closer to 40
    assert choose_pattern(both, kind="question_paper", count=100, nodes=1) == RPSC
    assert choose_pattern([], kind="question_paper", count=None, nodes=1) is None
