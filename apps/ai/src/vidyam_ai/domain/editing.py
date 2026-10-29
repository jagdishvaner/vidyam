"""Editing a document by chat (plan v3 §6.9). Pure; no I/O.

The edit agent reads a short outline of the document, one line per question or section, each with the id it
must use. It answers with changes. Code turns those into edit operations, which the API applies to the
version the agent read, and into rewrite requests, which the EditDocument workflow writes. Ids the outline
doesn't have are refused here, so a model's slip never reaches the paper.
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from vidyam_ai.domain.specs import type_name

FIRST_WORDS = 12
MAX_REWRITES = 50
_LEVELS = {1: "very easy", 2: "easy", 3: "medium", 4: "hard", 5: "very hard"}
_STATES = {
    "pending": "being written",
    "bank": "from the bank",
    "generated": "new",
    "verified": "checked",
    "flagged": "flagged",
    "insufficient_evidence": "no question (no material)",
    "edited": "edited by the teacher",
    "written": "written",
}


def is_paper(content: Mapping[str, Any]) -> bool:
    return "slots" in content


def _words(text: str, count: int = FIRST_WORDS) -> str:
    words = text.split()
    return " ".join(words[:count]) + (" …" if len(words) > count else "")


def ordered_slots(content: Mapping[str, Any]) -> list[dict[str, Any]]:
    """A paper's slots in the order its questions are numbered: section by section."""
    by_id = {slot["slotId"]: slot for slot in content["slots"]}
    return [by_id[i] for section in content["sections"] for i in section["slotIds"] if i in by_id]


def outline(
    content: Mapping[str, Any],
    questions: Mapping[str, Mapping[str, Any]],
    names: Mapping[str, str],
) -> str:
    """The document as the edit agent sees it: one line per question (or section), with the id to use."""
    spec = content["spec"]
    lines = [f'Title: "{spec["title"]}"', f"Languages: {', '.join(spec.get('languages', []))}"]
    if not is_paper(content):
        for section in content["sections"]:
            body: Mapping[str, str] = section.get("body") or {}
            title: Mapping[str, str] = section["title"]
            text = body.get("en") or body.get("hi") or ""
            name = names.get(section["nodeId"]) or title.get("en") or title.get("hi", "")
            state = _STATES.get(section["state"], section["state"])
            lines.append(
                f"Section [{section['nodeId']}] {name} · {state}" + (f" · {_words(text)}" if text else "")
            )
        return "\n".join(lines)
    number = 0
    for index, section in enumerate(content["sections"]):
        heading: Mapping[str, str] = section.get("name") or {}
        lines.append(f"Section {index + 1}: {heading.get('en') or heading.get('hi') or ''}")
        for slot_id in section["slotIds"]:
            slot = next(s for s in content["slots"] if s["slotId"] == slot_id)
            number += 1
            question = questions.get(str(slot.get("questionId"))) if slot.get("questionId") else None
            version = question and (question["content"].get("en") or question["content"].get("hi"))
            parts = [
                f"Q{number} [{slot_id}]",
                type_name(slot["qtype"], "en"),
                names.get(slot["taxonomyNodeId"], ""),
                f"difficulty {slot['difficulty']} ({_LEVELS.get(slot['difficulty'], '')})",
                f"{slot['marks']:g} marks",
                _STATES.get(slot["state"], slot["state"]),
            ]
            if version:
                parts.append(_words(version["stem"]))
            lines.append(" · ".join(part for part in parts if part))
    return "\n".join(lines)


@dataclass
class Planned:
    """What a plan of changes comes to: operations for the API, rewrites for the workflow, and changes that
    couldn't be made, in words for the teacher."""

    ops: list[dict[str, Any]] = field(default_factory=list[dict[str, Any]])
    rewrites: list[dict[str, Any]] = field(default_factory=list[dict[str, Any]])
    problems: list[str] = field(default_factory=list[str])


_ID = re.compile(r"\[?([^\]\s]+)\]?")


def _id(raw: str) -> str:
    match = _ID.fullmatch(raw.strip())
    return match.group(1) if match else raw.strip()


def plan(changes: Sequence[Mapping[str, Any]], content: Mapping[str, Any]) -> Planned:
    """The agent's changes as edit operations and rewrite requests, checked against the document."""
    paper = is_paper(content)
    known = (
        {slot["slotId"]: slot for slot in content["slots"]}
        if paper
        else {section["nodeId"]: section for section in content["sections"]}
    )
    out = Planned()
    for change in changes:
        action = change["action"]
        items = [_id(item) for item in change.get("items", [])]
        missing = [item for item in items if item not in known]
        if missing:
            out.problems.append(f"there is no item {', '.join(missing)}")
            items = [item for item in items if item in known]
        if action == "rename":
            if change.get("text"):
                out.ops.append({"op": "set_title", "title": str(change["text"]).strip()[:200]})
            continue
        if not items:
            continue
        if action == "remove":
            out.ops.append(
                {"op": "delete_items", "slotIds": items}
                if paper
                else {"op": "delete_sections", "nodeIds": items}
            )
        elif action == "rewrite":
            for item in items:
                difficulty = change.get("difficulty")
                out.rewrites.append({
                    "itemId": item,
                    "instruction": (str(change.get("text") or "").strip() or "write it again")[:500],
                    "difficulty": max(1, min(5, int(difficulty))) if difficulty else None,
                })  # fmt: skip
        elif not paper:
            out.problems.append(f"notes can't be changed that way ({action})")
        elif action == "marks" and change.get("marks"):
            out.ops.extend(
                {"op": "set_marks", "slotId": item, "marks": float(change["marks"])} for item in items
            )
        elif action == "move" and change.get("position"):
            section = next(s for s in content["sections"] if items[0] in s["slotIds"])
            order = [i for i in section["slotIds"] if i != items[0]]
            at = max(0, min(len(order), int(change["position"]) - 1))
            order.insert(at, items[0])
            out.ops.append({"op": "reorder", "slotIds": order})
        elif action == "instructions" and change.get("text"):
            index = known[items[0]]["sectionIndex"]
            out.ops.append(
                {"op": "set_instructions", "sectionIndex": index, "instructions": {"en": change["text"]}}
            )
    seen: set[str] = set()
    out.rewrites = [r for r in out.rewrites if not (r["itemId"] in seen or seen.add(r["itemId"]))][
        :MAX_REWRITES
    ]
    return out


_DONE = {
    "en": {
        "rewritten": "{n} rewritten",
        "kept": "{n} kept as they were ({why})",
        "none": "None could be rewritten ({why}), so the paper is as it was.",
    },
    "hi": {
        "rewritten": "{n} दोबारा लिखे गए",
        "kept": "{n} पहले जैसे रखे गए ({why})",
        "none": "कोई भी दोबारा नहीं लिखा जा सका ({why}), इसलिए दस्तावेज़ पहले जैसा है।",
    },
}


def rewrite_summary(asked: str, rewritten: int, kept: Sequence[str], language: str) -> str:
    """The chat's message when a rewrite ends: what was asked, and how it went."""
    words = _DONE.get(language, _DONE["en"])
    why = "; ".join(dict.fromkeys(kept)) if kept else ""
    if rewritten == 0:
        return f"{asked} {words['none'].format(why=why)}".strip()
    parts = [words["rewritten"].format(n=rewritten)]
    if kept:
        parts.append(words["kept"].format(n=len(kept), why=why))
    return f"{asked} ({'; '.join(parts)}.)".strip()
