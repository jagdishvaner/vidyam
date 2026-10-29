"""Making a paper or notes (plan v3 §7). Pure; no I/O.

- **Slots**: every question of a paper is a slot with its section, type, chapter, difficulty and marks.
  Questions are shared across chapters by the exam's weightage (evenly without one), and each chapter gets
  its share of easy, medium and hard questions, so the hard ones aren't bunched in one chapter.
- **Fast checks** run in code on every written question before a model looks at it again: each language
  present, options and exactly one correct key for single-choice questions, a numeric answer for numeric
  ones, citations of the evidence it was given, balanced mathematics, Hindi in Devanagari.
- **Assembly**: sections in order, and booklet sets (A–D) with their own order of questions and options;
  each set's correct answers spread evenly over the option positions, "all/none of the above" kept last.
"""

import hashlib
import math
import random
import re
from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any
from uuid import UUID

from vidyam_ai.domain.devanagari import script_mix
from vidyam_ai.domain.specs import DEFAULT_MIX, QUESTIONS_PER_CALL

Slot = dict[str, Any]  # PaperSlot, as stored (camelCase)

LEVELS = {"easy": 2, "medium": 3, "hard": 4}  # the 1–5 difficulty each level aims at
OPTION_TYPES = frozenset(
    {"mcq_single", "mcq_multi", "assertion_reason", "match_columns", "statement", "passage"}
)
NUMERIC_TYPES = frozenset({"numerical", "integer"})
TEXT_TYPES = frozenset({"short_answer", "long_answer"})
OPEN = ("pending", "flagged")  # slot states a retry may fill again
NO_EVIDENCE = "nothing in the center's material covers this chapter yet"
NO_BANK = "the bank has no more questions of this kind for this chapter"


def shares(total: int, weights: Sequence[float]) -> list[int]:
    """`total` split in proportion to `weights` by largest remainder (equal shares when all are zero)."""
    if not weights:
        return []
    if sum(weights) <= 0:
        weights = [1.0] * len(weights)
    whole = sum(weights)
    exact = [total * weight / whole for weight in weights]
    counts = [math.floor(value) for value in exact]
    by_remainder = sorted(range(len(exact)), key=lambda i: exact[i] - counts[i], reverse=True)
    for i in by_remainder[: total - sum(counts)]:
        counts[i] += 1
    return counts


def section_nodes(section: Mapping[str, Any], nodes: Sequence[str], paths: Mapping[str, str]) -> list[str]:
    """The paper's chapters a section draws from: those under its scope (JEE's Physics section), else all."""
    scope: list[str] = list(section.get("scope") or [])
    inside = [
        node
        for node in nodes
        if any(paths.get(node, "") == s or paths.get(node, "").startswith(s + "/") for s in scope)
    ]
    return inside or list(nodes)


def plan_slots(
    spec: Mapping[str, Any], weights: Mapping[str, float], paths: Mapping[str, str] | None = None
) -> list[Slot]:
    """Every question of the paper as a slot: section by section, chapter by chapter, easy to hard.
    `weights`: the exam's weightage by node; `paths`: code paths by node, for sections scoped to a subject."""
    # A chapter without weightage counts as an average one, so no chosen chapter is left out.
    known = [w for w in weights.values() if w > 0]
    usual = sum(known) / len(known) if known else 1.0
    slots: list[Slot] = []
    for index, section in enumerate(spec["sections"]):
        nodes = section_nodes(section, spec["taxonomyNodeIds"], paths or {})
        count = int(section["count"])
        mix = section.get("difficultyMix") or DEFAULT_MIX
        # What is left of the section's easy/medium/hard; each chapter takes its share of what remains, so
        # the totals come out exact.
        left = shares(count, [float(mix.get(level, 0)) for level in LEVELS])
        n = 0
        for node, need in zip(
            nodes, shares(count, [weights.get(node) or usual for node in nodes]), strict=True
        ):
            own = shares(need, [float(x) for x in left])
            left = [a - b for a, b in zip(left, own, strict=True)]
            for difficulty, times in zip(LEVELS.values(), own, strict=True):
                for _ in range(times):
                    n += 1
                    slots.append(
                        {
                            "slotId": f"s{index + 1}-{n}",
                            "sectionIndex": index,
                            "qtype": section["qtype"],
                            "taxonomyNodeId": node,
                            "difficulty": difficulty,
                            "marks": section["marksEach"],
                            "state": "pending",
                            "questionId": None,
                            "flags": [],
                        }
                    )
    return slots


def groups(slots: Sequence[Slot], size: int = QUESTIONS_PER_CALL) -> list[list[Slot]]:
    """Slots still to fill (pending, or flagged and to be written again), by chapter and question type, at
    most one model call's worth each."""
    by_kind: dict[tuple[str, str], list[Slot]] = {}
    for slot in slots:
        if slot["state"] in OPEN:
            by_kind.setdefault((slot["taxonomyNodeId"], slot["qtype"]), []).append(slot)
    return [members[i : i + size] for members in by_kind.values() for i in range(0, len(members), size)]


# --- Fast checks ---------------------------------------------------------------------------------------


_MATH = re.compile(r"\$\$.*?\$\$|\$.*?\$", re.DOTALL)


def _math_balanced(text: str) -> bool:
    if text.replace("\\$", "").count("$") % 2:
        return False
    depth = 0
    for char in text.replace("\\{", "").replace("\\}", ""):
        depth += {"{": 1, "}": -1}.get(char, 0)
        if depth < 0:
            return False
    return depth == 0


def _language(lang: str) -> str:
    return {"hi": "Hindi", "en": "English"}.get(lang, lang)


def check_question(
    qtype: str,
    content: Mapping[str, Any],
    answer: Mapping[str, Any],
    languages: Sequence[str],
    cited: int,
) -> list[str]:
    """What is wrong with a written question, in words a teacher can read; nothing when it is fine.
    `content`: QuestionContent; `answer`: Answer; `cited`: how many of the given passages it cites."""
    problems: list[str] = []
    versions: dict[str, Mapping[str, Any]] = {}
    for lang in languages:
        version = content.get(lang)
        if not version or not str(version.get("stem", "")).strip():
            problems.append(f"no question text in {_language(lang)}")
            continue
        versions[lang] = version
        texts = [
            version["stem"],
            *(o["text"] for o in version.get("options", [])),
            version.get("solution") or "",
        ]
        if not all(_math_balanced(text) for text in texts):
            problems.append(f"unbalanced mathematics ($ or braces) in {_language(lang)}")
        if lang == "hi":
            # Formulas and units are Latin in Hindi papers too; the words around them must be Devanagari.
            hindi, latin = script_mix(_MATH.sub(" ", version["stem"]))
            if hindi == 0 or latin > hindi:
                problems.append("the Hindi version isn't written in Devanagari")
    if qtype in OPTION_TYPES:
        keyed = [[o["key"] for o in version.get("options", [])] for version in versions.values()]
        keys = set(keyed[0]) if keyed else set[str]()
        if keyed and len(keys) < 2:
            problems.append("fewer than two options")
        if any(set(other) != keys or len(other) != len(set(other)) for other in keyed):
            problems.append("the languages have different options")
        chosen = list(answer.get("keys", [])) if answer.get("kind") == "options" else []
        if qtype == "mcq_single" and len(chosen) != 1:
            problems.append("not exactly one correct option")
        elif keyed and (not chosen or not set(chosen) <= keys):
            problems.append("the answer isn't one of the options")
    elif qtype in NUMERIC_TYPES:
        if answer.get("kind") != "numeric":
            problems.append("no numeric answer")
        elif qtype == "integer" and float(answer["value"]) != int(answer["value"]):
            problems.append("the answer isn't a whole number")
    elif qtype in TEXT_TYPES and not (
        answer.get("kind") == "text" and str(answer.get("modelAnswer", "")).strip()
    ):
        problems.append("no model answer")
    if cited == 0:
        problems.append("cites none of the evidence")
    return problems


def answers_agree(answer: Mapping[str, Any], solved: Mapping[str, Any]) -> bool:
    """Whether a blind re-solve reached the key: the same option keys, or the same number within tolerance."""
    if answer.get("kind") == "options":
        return sorted(answer.get("keys", [])) == sorted(solved.get("keys") or [])
    if answer.get("kind") == "numeric":
        value = solved.get("value")
        if value is None:
            return False
        tolerance = max(float(answer.get("tolerance", 0)), 1e-9 * max(1.0, abs(float(answer["value"]))))
        return abs(float(value) - float(answer["value"])) <= tolerance
    return True  # written answers are judged by grounding, not re-solved


def shown(answer: Mapping[str, Any]) -> str:
    """An answer as a teacher would write it on a badge: "B", "A, C", "9.8"."""
    if answer.get("kind") == "options":
        return ", ".join(answer.get("keys") or []) or "none"
    if answer.get("kind") == "numeric" and answer.get("value") is not None:
        return f"{float(answer['value']):g}"
    return "no answer"


# --- Assembly ------------------------------------------------------------------------------------------

_KEEP_LAST = re.compile(
    r"\b(all|none|both) of (the|these)\b|उपर्युक्त|उपरोक्त|इनमें से कोई नहीं|इनमें से सभी", re.IGNORECASE
)


def seeded(*parts: str) -> random.Random:
    """A random order fixed by its seed, so the same paper always shuffles the same way."""
    return random.Random(int(hashlib.sha256("|".join(parts).encode()).hexdigest()[:16], 16))


def option_order(
    keys: Sequence[str],
    texts: Mapping[str, str],
    rng: random.Random,
    *,
    correct: str | None = None,
    target: int | None = None,
) -> list[str]:
    """The option keys shuffled, "all/none of the above" options kept last, and the correct one moved to
    position `target` when it can go there."""
    fixed = [key for key in keys if _KEEP_LAST.search(texts.get(key, ""))]
    free = [key for key in keys if key not in fixed]
    rng.shuffle(free)
    if correct in free and target is not None and target < len(free):
        free.remove(correct)
        free.insert(target, correct)
    return [*free, *fixed]


def _single_key(answer: Mapping[str, Any]) -> str | None:
    keys: list[str] = list(answer.get("keys") or [])
    return keys[0] if answer.get("kind") == "options" and len(keys) == 1 else None


def assemble(
    spec: Mapping[str, Any],
    slots: Sequence[Slot],
    questions: Mapping[str, Mapping[str, Any]],
    seed: str,
) -> dict[str, Any]:
    """The PaperDocument: sections, slots and booklet sets. `questions`: by id, each with `content` and
    `answer`. Set A keeps the paper's order; the others shuffle questions within each section."""
    by_id = {slot["slotId"]: slot for slot in slots}
    sections: list[dict[str, Any]] = [
        {
            "name": section.get("name") or {"en": f"Section {n + 1}", "hi": f"खंड {n + 1}"},
            "instructions": None,
            "slotIds": [slot["slotId"] for slot in slots if slot["sectionIndex"] == n],
        }
        for n, section in enumerate(spec["sections"])
    ]
    sets: list[dict[str, Any]] = []
    codes: list[str] = list(spec.get("setCodes") or [])
    for code in codes:
        rng = seeded(seed, code)
        order: list[str] = []
        for section in sections:
            ids: list[str] = list(section["slotIds"])
            if code != "A":
                rng.shuffle(ids)
            order.extend(ids)
        options: dict[str, list[str]] = {}
        used: Counter[int] = Counter()  # how often each position holds the correct option in this set
        for slot_id in order:
            question = questions.get(str(by_id[slot_id]["questionId"]))
            if question is None:
                continue
            content = question["content"]
            version = content.get("en") or content.get("hi")
            if not version or not version.get("options"):
                continue
            keys = [o["key"] for o in version["options"]]
            texts = {o["key"]: o["text"] for o in version["options"]}
            correct = _single_key(question["answer"])
            target = min(range(len(keys)), key=lambda p: (used[p], p)) if correct else None
            options[slot_id] = option_order(keys, texts, rng, correct=correct, target=target)
            if correct:
                used[options[slot_id].index(correct)] += 1
        sets.append({"code": code, "slotOrder": order, "optionOrder": options})
    return {"spec": dict(spec), "sections": sections, "slots": [dict(slot) for slot in slots], "sets": sets}


def outcome(states: Sequence[str]) -> dict[str, int]:
    """How the slots or sections ended, by state."""
    return dict(Counter(states))


_SUMMARY = {
    "en": {
        "ready": "Your {kind} is ready: {parts}.",
        "none": "I couldn't make any of it: {reason}.",
        "bank": "{n} from your question bank",
        "verified": "{n} new and checked",
        "generated": "{n} new",
        "written": "{n} sections written",
        "flagged": "{n} flagged for you to look at",
        "insufficient_evidence": "{n} not made, for want of material",
        "pending": "{n} not made",
    },
    "hi": {
        "ready": "आपका {kind} तैयार है: {parts}।",
        "none": "इसमें से कुछ भी नहीं बन सका: {reason}।",
        "bank": "{n} प्रश्न-बैंक से",
        "verified": "{n} नए और जाँचे हुए",
        "generated": "{n} नए",
        "written": "{n} खंड लिखे गए",
        "flagged": "{n} आपकी जाँच के लिए चिह्नित",
        "insufficient_evidence": "{n} सामग्री न होने से नहीं बने",
        "pending": "{n} नहीं बने",
    },
}
_KIND = {
    "en": {
        "question_paper": "paper",
        "worksheet": "worksheet",
        "notes": "notes",
        "revision_sheet": "revision sheet",
    },
    "hi": {
        "question_paper": "प्रश्न-पत्र",
        "worksheet": "अभ्यास-पत्र",
        "notes": "नोट्स",
        "revision_sheet": "पुनरावृत्ति-पत्र",
    },
}


def summary(kind: str, counts: Mapping[str, int], language: str) -> str:
    """The chat's message when a document is made: what came from where, and what needs the teacher."""
    words = _SUMMARY.get(language, _SUMMARY["en"])
    made = sum(n for state, n in counts.items() if state not in ("insufficient_evidence", "pending"))
    if made == 0:
        return words["none"].format(reason=NO_EVIDENCE if language != "hi" else "सामग्री उपलब्ध नहीं है")
    order = ("bank", "verified", "generated", "written", "flagged", "insufficient_evidence", "pending")
    parts = [words[state].format(n=counts[state]) for state in order if counts.get(state)]
    return words["ready"].format(
        kind=_KIND.get(language, _KIND["en"]).get(kind, kind), parts=", ".join(parts)
    )


def message_id(run_id: UUID | str, purpose: str) -> str:
    """A chat message id fixed by the run, so a retried step writes its message once (a UUIDv8)."""
    digest = bytearray(hashlib.sha256(f"{purpose}:{run_id}".encode()).digest()[:16])
    digest[6] = (digest[6] & 0x0F) | 0x80
    digest[8] = (digest[8] & 0x3F) | 0x80
    return str(UUID(bytes=bytes(digest)))
