"""Question papers and answer keys (plan v3 §5, step 6), and the stub model's answers for backlog tasks."""

import json

from vidyam_ai.domain.llm import Image, ModelCall, Segment, Turn
from vidyam_ai.domain.papers import PaperPage, parse_answer_key, rule_split, windows
from vidyam_ai.generated.contracts import OcrPage, SegmentedPaper, TopicTags
from vidyam_ai.infrastructure.llm.stub import answer


def test_answer_keys_are_read_in_their_common_layouts() -> None:
    assert parse_answer_key("1. C 2. D 3. A 4. B 5. A\n6. C") == {
        1: "C",
        2: "D",
        3: "A",
        4: "B",
        5: "A",
        6: "C",
    }
    assert parse_answer_key("Q.1 (b)  Q.2 (a)  Q.3 (d)  Q.4 (c)  Q.5 (a)") == {
        1: "B",
        2: "A",
        3: "D",
        4: "C",
        5: "A",
    }
    hindi = "प्रश्न उत्तर\n1-क 2-ख 3-ग 4-घ 5-क"
    assert parse_answer_key(hindi) == {1: "A", 2: "B", 3: "C", 4: "D", 5: "A"}
    table = "| Q | Ans |\n|---|---|\n| 1 | C |\n| 2 | A |\n| 3 | B |\n| 4 | D |\n| 5 | C |"
    assert parse_answer_key(table) == {1: "C", 2: "A", 3: "B", 4: "D", 5: "C"}


def test_text_that_isnt_a_whole_key_is_not_taken_for_one() -> None:
    assert parse_answer_key("Science Mock Test 1 (2025), Booklet set: A") == {}
    assert parse_answer_key("1. C 2. D 3. A 40. B 77. C 90. D") == {}  # most numbers missing


def test_papers_are_sent_a_few_pages_at_a_time_with_the_next_page_for_context() -> None:
    pages = [PaperPage(n, f"text {n}") for n in range(1, 7)]
    found = windows(pages, size=4)
    assert [(w.first_page, w.last_page) for w in found] == [(1, 4), (5, 6)]
    assert found[0].text.endswith("=== page 5 ===\ntext 5")
    assert "=== page 7" not in found[1].text


def test_rule_split_follows_the_numbering_and_splits_languages() -> None:
    text = "\n".join(
        [
            "=== page 3 ===",
            "Instructions: answer all questions.",
            "7. निम्नलिखित कथनों पर विचार कीजिए: 1. दूरी अदिश है। 2. वेग सदिश है।",
            "Consider the following statements: 1. Distance is a scalar. 2. Velocity is a vector.",
            "(A) केवल 1 / 1 only",
            "(B) 1 और 2 / 1 and 2",
            "8. 2 kg द्रव्यमान पर 10 N बल लगता है। त्वरण है:",
            "A force of 10 N acts on a mass of 2 kg. The acceleration is:",
            "(A) 5 m/s²",
            "=== page 4 ===",
            "9. Next question starts on the next window's page.",
        ]
    )
    found = rule_split(text, 3, 3)
    assert [(q.number, q.page, q.qtype()) for q in found] == [(7, 3, "statement"), (8, 3, "mcq_single")]
    first = found[0]
    assert first.text("hi") == {
        "stem": "निम्नलिखित कथनों पर विचार कीजिए: 1. दूरी अदिश है। 2. वेग सदिश है।",
        "options": [{"key": "A", "text": "केवल 1"}, {"key": "B", "text": "1 और 2"}],
        "solution": None,
    }
    assert found[1].text("en")["options"] == [{"key": "A", "text": "5 m/s²"}]  # type: ignore[index]


def _call(task: str, variables: dict[str, str], system: tuple[Segment, ...] = ()) -> ModelCall:
    turns = (Turn("user", "go"),)
    return ModelCall("stub", system, turns, max_tokens=1000, task=task, variables=variables)


def test_the_stub_answers_the_backlog_tasks_in_their_schemas() -> None:
    ocr = answer(
        ModelCall(
            model="stub",
            system=(),
            turns=(Turn("user", "read", (Image("image/png", b"png"),)),),
            max_tokens=1000,
            task="ocr_text",
            variables={"page": "41", "file_title": "Biology"},
        )
    )
    page = OcrPage.model_validate_json(ocr.text)
    assert page.legibility == 0 and "page 41 of Biology" in page.markdown
    assert ocr.usage.input_tokens > 1_600  # the image is counted as a real model would

    text = "=== page 1 ===\n1. What is the SI unit of force?\n(A) newton\n(B) joule"
    paper = SegmentedPaper.model_validate_json(
        answer(_call("segment", {"text": text, "first_page": "1", "last_page": "1"})).text
    )
    [question] = paper.questions
    assert (
        question.en
        and question.en.stem == "What is the SI unit of force?"
        and question.qtype.value == "mcq_single"
    )

    candidates = "\n".join(
        [
            "Syllabus candidates under Motion (science/physics/motion):",
            "science/physics/motion/speed_velocity | Speed and Velocity | चाल और वेग | ",
            "science/physics/motion/acceleration | Acceleration | त्वरण | tvaran",
        ]
    )
    tagged = TopicTags.model_validate_json(
        answer(
            _call(
                "tag",
                {"text": "वेग में परिवर्तन की दर को त्वरण कहते हैं।", "heading_path": "गति", "kind": "passage"},
                system=(Segment(candidates, "1h"),),
            )
        ).text
    )
    assert [(tag.node.root, tag.confidence) for tag in tagged.tags] == [
        ("science/physics/motion/acceleration", 0.95)
    ]
    nothing = TopicTags.model_validate_json(
        answer(
            _call(
                "tag",
                {"text": "Photosynthesis", "heading_path": "", "kind": "passage"},
                system=(Segment(candidates, "1h"),),
            )
        ).text
    )
    assert nothing.tags == []
    assert json.loads(answer(_call("segment", {"text": "", "first_page": "1", "last_page": "1"})).text) == {
        "questions": []
    }
