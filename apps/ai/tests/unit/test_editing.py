"""Editing a document by chat (plan v3 §6.9, step 28): the outline the edit agent reads, its changes turned
into edit operations and rewrite requests (ids it made up refused), the message when a rewrite ends, and the
stub model reading edit requests the way a careful script would."""

import json
from typing import Any

from vidyam_ai.domain.editing import outline, plan, rewrite_summary
from vidyam_ai.domain.llm import ModelCall, Turn
from vidyam_ai.infrastructure.llm.stub import answer

NODE = "6a3e8a52-6f2c-4bd5-9a43-2b2f3c0f9d11"
Q1, Q2 = "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"


def slot(slot_id: str, section: int, question: str | None, difficulty: int = 3) -> dict[str, Any]:
    state = "verified" if question else "insufficient_evidence"
    return {"slotId": slot_id, "sectionIndex": section, "qtype": "mcq_single", "taxonomyNodeId": NODE,
            "difficulty": difficulty, "marks": 2, "state": state, "questionId": question,
            "flags": []}  # fmt: skip


PAPER: dict[str, Any] = {
    "spec": {"title": "Force test", "languages": ["hi", "en"]},
    "sections": [
        {"name": {"en": "MCQ"}, "instructions": None, "slotIds": ["s1-1", "s1-2", "s1-3"]},
        {"name": {"en": "Numerical"}, "instructions": None, "slotIds": ["s2-1"]},
    ],
    "slots": [slot("s1-1", 0, Q1, 2), slot("s1-2", 0, Q2), slot("s1-3", 0, None), slot("s2-1", 1, None)],
    "sets": [],
}
QUESTIONS = {
    Q1: {"qtype": "mcq_single", "content": {"hi": {"stem": "बल का SI मात्रक क्या है?"}, "en": None}},
    Q2: {
        "qtype": "mcq_single",
        "content": {"en": {"stem": "Which law explains the recoil of a gun when fired?"}},
    },
}


def change(action: str, items: list[str], **fields: Any) -> dict[str, Any]:
    return {"action": action, "items": items, "position": None, "marks": None, "text": None,
            "difficulty": None, **fields}  # fmt: skip


def test_the_outline_numbers_questions_with_the_ids_to_use() -> None:
    lines = outline(PAPER, QUESTIONS, {NODE: "Force and Laws of Motion"}).split("\n")
    assert lines[0] == 'Title: "Force test"'
    assert lines[2] == "Section 1: MCQ"
    assert lines[3] == (
        "Q1 [s1-1] · Multiple choice · Force and Laws of Motion · difficulty 2 (easy) · 2 marks · checked · "
        "बल का SI मात्रक क्या है?"
    )
    assert lines[5].startswith("Q3 [s1-3] ") and lines[5].endswith("no question (no material)")
    assert lines[7].startswith("Q4 [s2-1] ")


def test_changes_become_edit_operations_and_rewrites() -> None:
    planned = plan(
        [
            change("remove", ["[s1-3]"]),
            change("move", ["s1-2"], position=1),
            change("marks", ["s2-1"], marks=4),
            change("rename", [], text="Force quiz"),
            change("instructions", ["s2-1"], text="Use SI units."),
            change("rewrite", ["s1-1"], text="harder", difficulty=7),
            change("rewrite", ["s1-1", "s9-9"], text="again"),
        ],
        PAPER,
    )
    assert planned.ops == [
        {"op": "delete_items", "slotIds": ["s1-3"]},
        {"op": "reorder", "slotIds": ["s1-2", "s1-1", "s1-3"]},
        {"op": "set_marks", "slotId": "s2-1", "marks": 4.0},
        {"op": "set_title", "title": "Force quiz"},
        {"op": "set_instructions", "sectionIndex": 1, "instructions": {"en": "Use SI units."}},
    ]
    # One rewrite per item (the first asked), difficulty kept within 1–5; made-up ids are refused.
    assert planned.rewrites == [{"itemId": "s1-1", "instruction": "harder", "difficulty": 5}]
    assert planned.problems == ["there is no item s9-9"]


def test_notes_take_removals_and_rewrites_only() -> None:
    notes = {
        "spec": {"title": "Notes", "languages": ["hi"]},
        "sections": [{"nodeId": NODE, "title": {"en": "Force"}, "body": {"hi": "बल [1]"}, "citations": [],
                      "state": "verified", "flags": []}],
    }  # fmt: skip
    planned = plan([change("rewrite", [NODE], text="shorter"), change("marks", [NODE], marks=2)], notes)
    assert planned.rewrites == [{"itemId": NODE, "instruction": "shorter", "difficulty": None}]
    assert planned.ops == [] and planned.problems == ["notes can't be changed that way (marks)"]
    assert outline(notes, {}, {NODE: "Force"}).split("\n")[2] == f"Section [{NODE}] Force · checked · बल [1]"


def test_the_message_when_a_rewrite_ends() -> None:
    assert (
        rewrite_summary("Making question 3 harder.", 1, [], "en")
        == "Making question 3 harder. (1 rewritten.)"
    )
    assert rewrite_summary("Rewriting.", 2, ["no material", "no material"], "en") == (
        "Rewriting. (2 rewritten; 2 kept as they were (no material).)"
    )
    assert rewrite_summary("Rewriting.", 0, ["no material"], "en").endswith("so the paper is as it was.")


def stub_edit(message: str, document: str) -> dict[str, Any]:
    call = ModelCall(
        model="stub", system=(), turns=(Turn("user", message),), max_tokens=100, effort=None, output=None,
        task="edit_agent", variables={"kind": "question paper", "outline": document},
    )  # fmt: skip
    return json.loads(answer(call).text)


def test_the_stub_reads_edit_requests_against_the_outline() -> None:
    document = outline(PAPER, QUESTIONS, {NODE: "Force"})
    removed = stub_edit("please remove Q2 and question 3", document)
    assert removed["changes"] == [change("remove", ["s1-2", "s1-3"])]
    assert removed["reply"] == "Removing questions 2 and 3."
    harder = stub_edit("question 1 ko kathin karo", document)["changes"]
    assert harder == [change("rewrite", ["s1-1"], text="harder", difficulty=3)]
    assert stub_edit("Q4 ko 3 marks do", document)["changes"] == [change("marks", ["s2-1"], marks=3.0)]
    assert stub_edit("move Q3 to the top", document)["changes"] == [change("move", ["s1-3"], position=1)]
    unclear = stub_edit("make it better", document)
    assert unclear["changes"] == [] and unclear["reply"].startswith("Which question")
