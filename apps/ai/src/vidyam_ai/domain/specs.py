"""What the teacher wants made, gathered across the chat (plan v3 §6–7, ADR 0015). Pure; no I/O.

The draft spec (`DraftSpec`, kept on the chat as JSON) fills in from what the teacher says and from the cards
they answer. Rules here, not the model, decide:

- the paper's sections: the exam's pattern, scaled to the number of questions asked for, kept to the
  question types asked for, at the difficulty asked for;
- defaults: the teacher's languages, bank first, the pattern's duration;
- what is still missing, and so which cards to ask: at most two, scope (what it covers) then shape (how the
  paper is built);
- the complete spec on the review card, what the bank already has for each chapter, and a cost estimate.
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from vidyam_ai.domain.llm import Usage

Draft = dict[str, Any]  # DraftSpec, as stored (camelCase)

PAPERS = ("question_paper", "worksheet")
NOTES = ("notes", "revision_sheet")
DIFFICULTY = {
    "easy": {"easy": 0.6, "medium": 0.3, "hard": 0.1},
    "medium": {"easy": 0.3, "medium": 0.5, "hard": 0.2},
    "hard": {"easy": 0.1, "medium": 0.4, "hard": 0.5},
}
DEFAULT_MIX = DIFFICULTY["medium"]
WORKSHEET_QUESTIONS = 20

_TYPE_NAMES = {
    "mcq_single": ("Multiple choice", "बहुविकल्पीय"),
    "mcq_multi": ("Multiple correct", "बहु-सही विकल्प"),
    "numerical": ("Numerical", "आंकिक"),
    "integer": ("Integer answer", "पूर्णांक उत्तर"),
    "assertion_reason": ("Assertion and reason", "अभिकथन एवं कारण"),
    "match_columns": ("Match the columns", "स्तंभ मिलान"),
    "statement": ("Statements", "कथन"),
    "passage": ("Passage based", "गद्यांश आधारित"),
    "short_answer": ("Short answer", "लघु उत्तरीय"),
    "long_answer": ("Long answer", "दीर्घ उत्तरीय"),
}
_KIND_NAMES = {
    "question_paper": ("Question paper", "प्रश्न-पत्र"),
    "worksheet": ("Worksheet", "अभ्यास पत्रक"),
    "notes": ("Notes", "नोट्स"),
    "revision_sheet": ("Revision sheet", "पुनरावृत्ति पत्रक"),
}


@dataclass(frozen=True)
class Pattern:
    """One of an exam's paper patterns (an active blueprint): "Full paper", "Chapter test", …"""

    id: UUID
    sections: Sequence[Mapping[str, Any]]  # PaperSection, as stored
    duration_minutes: int
    default_mix: Mapping[str, float]
    name: str = ""

    @property
    def questions(self) -> int:
        return sum(int(section["count"]) for section in self.sections)


NARROW = 3  # this many chapters or topics or fewer is a chapter test, not a full paper


def choose_pattern(
    patterns: Sequence[Pattern], *, kind: str | None, count: int | None, nodes: int
) -> Pattern | None:
    """The pattern a request fits: the one closest to the number of questions asked for; without a number, the
    chapter test for a worksheet or a few chapters, and the full paper for a whole subject."""
    if not patterns:
        return None
    full = [p for p in patterns if p.name.casefold().startswith("full paper")]
    chapter = [p for p in patterns if p.name.casefold().startswith("chapter test")]
    if count:
        return min(patterns, key=lambda p: (abs(p.questions - count), p not in full))
    if kind == "worksheet" or (0 < nodes <= NARROW):
        return (chapter or sorted(patterns, key=lambda p: p.questions))[0]
    return (full or sorted(patterns, key=lambda p: -p.questions))[0]


@dataclass(frozen=True)
class Wish:
    """What one message or card asked for, names already resolved to ids."""

    kind: str | None = None
    exam_code: str | None = None
    node_ids: tuple[UUID, ...] = ()
    question_count: int | None = None
    question_types: tuple[str, ...] = ()
    difficulty: str | None = None  # easy, medium, hard
    languages: tuple[str, ...] = ()
    duration_minutes: int | None = None
    sourcing: str | None = None
    title: str | None = None


def layout_for(languages: Sequence[str]) -> str:
    return "hindi_then_english" if len(languages) > 1 else "single_language"


def languages_for(content_language: str | None) -> list[str]:
    """A teacher's content language setting as the languages of what is made (both, unless set)."""
    return {"hi": ["hi"], "en": ["en"]}.get(content_language or "", ["hi", "en"])


def scale(sections: Sequence[Mapping[str, Any]], total: int) -> list[dict[str, Any]]:
    """Sections at `total` questions in all, in proportion (largest remainder). Sections that round to nothing
    are dropped."""
    counts = [int(section["count"]) for section in sections]
    whole = sum(counts)
    if whole == 0 or total <= 0:
        return []
    exact = [count * total / whole for count in counts]
    result = [math.floor(value) for value in exact]
    by_remainder = sorted(range(len(exact)), key=lambda i: exact[i] - result[i], reverse=True)
    for i in by_remainder[: total - sum(result)]:
        result[i] += 1
    return [{**section, "count": n} for section, n in zip(sections, result, strict=True) if n > 0]


def split(total: int, parts: int) -> list[int]:
    """`total` shared out as evenly as possible, the first parts taking the remainder."""
    if parts <= 0:
        return []
    base, extra = divmod(total, parts)
    return [base + (1 if i < extra else 0) for i in range(parts)]


def sections_of(types: Sequence[str], total: int, mix: Mapping[str, float]) -> list[dict[str, Any]]:
    """One section per question type, the questions shared out evenly, one mark each."""
    return [
        {
            "name": dict(zip(("en", "hi"), _TYPE_NAMES.get(qtype, (qtype, qtype)), strict=True)),
            "qtype": qtype,
            "count": count,
            "marksEach": 1,
            "negativeMarks": 0,
            "attemptAny": None,
            "difficultyMix": dict(mix),
            "scope": [],
        }
        for qtype, count in zip(types, split(total, len(types)), strict=True)
        if count > 0
    ]


def _shape(
    kind: str | None,
    pattern: Pattern | None,
    current: Sequence[Mapping[str, Any]] | None,
    wish: Wish,
) -> list[dict[str, Any]] | None:
    """The sections for what was asked: the pattern's (or the current ones) kept to the types asked for,
    scaled to the count asked for, at the difficulty asked for. None when there is nothing to build from."""
    mix = DIFFICULTY.get(wish.difficulty or "")
    base: list[Mapping[str, Any]] = list(pattern.sections if pattern else current or [])
    if wish.question_types:
        base = [section for section in base if section["qtype"] in wish.question_types]
        if not base:
            total = wish.question_count or WORKSHEET_QUESTIONS
            return sections_of(
                wish.question_types, total, mix or (pattern.default_mix if pattern else DEFAULT_MIX)
            )
    if not base:
        if kind == "worksheet" or wish.question_count:
            return sections_of(["mcq_single"], wish.question_count or WORKSHEET_QUESTIONS, mix or DEFAULT_MIX)
        return None
    total = wish.question_count or sum(int(section["count"]) for section in base)
    sections = scale(base, total)
    return [{**section, "difficultyMix": dict(mix)} for section in sections] if mix else sections


def merge(draft: Draft, wish: Wish, pattern: Pattern | None) -> Draft:
    """The draft with what was just asked for. `pattern` is the exam's, for the exam the draft will have."""
    out = dict(draft)
    reshape = bool(wish.question_count or wish.question_types or wish.difficulty)
    if wish.kind:
        out["kind"] = wish.kind
    if wish.exam_code and wish.exam_code != draft.get("examCode"):
        out["examCode"] = wish.exam_code
        out["blueprintId"] = str(pattern.id) if pattern else None
        reshape = True
    if wish.node_ids:
        out["taxonomyNodeIds"] = [str(node) for node in dict.fromkeys(wish.node_ids)]
    if wish.languages:
        out["languages"] = list(dict.fromkeys(wish.languages))
        out["layout"] = layout_for(out["languages"])
    if wish.sourcing:
        out["sourcing"] = wish.sourcing
    if wish.title:
        out["title"] = wish.title
    if reshape and out.get("kind") in PAPERS:
        sections = _shape(out.get("kind"), pattern, draft.get("sections"), wish)
        if sections:
            out["sections"] = sections
            if pattern:  # the pattern's time, in proportion to the questions (to the nearest 5 minutes)
                share = sum(section["count"] for section in sections) / max(pattern.questions, 1)
                out["durationMinutes"] = max(10, round(pattern.duration_minutes * share / 5) * 5)
    if wish.duration_minutes:
        out["durationMinutes"] = wish.duration_minutes
    return out


def apply_values(draft: Draft, values: Mapping[str, Any]) -> Draft:
    """The draft with a card's plain answers (the exam and pattern go through `merge`)."""
    out = dict(draft)
    simple = {
        "kind": "kind",
        "taxonomy_nodes": "taxonomyNodeIds",
        "sections": "sections",
        "languages": "languages",
        "layout": "layout",
        "duration": "durationMinutes",
        "sourcing": "sourcing",
        "student_batch": "studentBatchId",
        "set_codes": "setCodes",
        "depth": "depth",
        "include_examples": "includeExamples",
        "include_practice": "includePractice",
        "title": "title",
    }
    for key, field in simple.items():
        if key in values:
            out[field] = values[key]
    if "languages" in values and "layout" not in values:
        out["layout"] = layout_for(out["languages"])
    if "difficulty_mix" in values and out.get("sections"):
        out["sections"] = [
            {**section, "difficultyMix": values["difficulty_mix"]} for section in out["sections"]
        ]
    return out


def with_defaults(draft: Draft, languages: Sequence[str], pattern: Pattern | None) -> Draft:
    """What the teacher hasn't said, from their settings and the exam's pattern."""
    out = dict(draft)
    out.setdefault("languages", list(languages))
    out.setdefault("layout", layout_for(out["languages"]))
    kind = out.get("kind")
    if kind in PAPERS:
        out.setdefault("sourcing", "bank_first")
        out.setdefault("setCodes", [])
        out.setdefault("studentBatchId", None)
        out.setdefault("examCode", None)
        if pattern and not out.get("sections"):
            out["sections"] = [dict(section) for section in pattern.sections]
            out["blueprintId"] = str(pattern.id)
        elif kind == "worksheet" and not out.get("sections"):
            out["sections"] = sections_of(["mcq_single"], WORKSHEET_QUESTIONS, DEFAULT_MIX)
        out.setdefault("blueprintId", None)
        if "durationMinutes" not in out:
            out["durationMinutes"] = pattern.duration_minutes if pattern else None
    elif kind in NOTES:
        out.setdefault("examCode", None)
        out.setdefault("depth", "standard")
        out.setdefault("includeExamples", True)
        out.setdefault("includePractice", kind == "revision_sheet")
    return out


def missing(draft: Draft) -> tuple[bool, bool]:
    """(scope, shape): whether what it covers, and how a paper is built, are still to be asked."""
    scope = not draft.get("kind") or not draft.get("taxonomyNodeIds")
    shape = draft.get("kind") in PAPERS and not draft.get("sections")
    return scope, shape


def cards(
    draft: Draft, card_id: str, *, scope: bool, shape: bool, node_suggestions: Sequence[UUID] = ()
) -> list[dict[str, Any]]:
    """The clarification cards for what is missing, each field opening with what the chat understood."""
    out: list[dict[str, Any]] = []
    kind = draft.get("kind")
    if scope:
        fields: list[dict[str, Any]] = []
        if not kind:
            fields.append({"key": "kind", "required": True})
        fields.append({"key": "exam", "required": False, "suggested": draft.get("examCode")})
        nodes: dict[str, Any] = {
            "key": "taxonomy_nodes",
            "required": True,
            "suggested": draft.get("taxonomyNodeIds") or [],
        }
        if node_suggestions:  # what a typed name could mean: offered, not chosen
            nodes["options"] = [str(node) for node in node_suggestions]
        fields.append(nodes)
        out.append(
            {"type": "clarification", "cardId": f"scope:{card_id}", "purpose": "scope", "fields": fields}
        )
    if shape:
        sections: list[Mapping[str, Any]] = draft.get("sections") or [{}]
        mix: Mapping[str, Any] = sections[0].get("difficultyMix", DEFAULT_MIX)
        fields = [
            {"key": "blueprint", "required": False, "suggested": draft.get("blueprintId")},
            {"key": "sections", "required": True, "suggested": draft.get("sections")},
            {"key": "difficulty_mix", "required": False, "suggested": mix},
            {"key": "languages", "required": True, "suggested": draft.get("languages")},
            {"key": "duration", "required": False, "suggested": draft.get("durationMinutes")},
            {"key": "sourcing", "required": False, "suggested": draft.get("sourcing", "bank_first")},
        ]
        out.append(
            {"type": "clarification", "cardId": f"shape:{card_id}", "purpose": "shape", "fields": fields}
        )
    return out


def title_for(kind: str, exam: str | None, nodes: Sequence[str], language: str) -> str:
    label = _KIND_NAMES.get(kind, (kind, kind))[1 if language == "hi" else 0]
    shown = ", ".join(nodes[:3]) + (f" +{len(nodes) - 3}" if len(nodes) > 3 else "")
    return f"{exam}: {shown}" if exam else f"{label}: {shown}"


def complete(draft: Draft, title: str) -> dict[str, Any]:
    """The TaskSpec of a draft with nothing missing."""
    common = {
        "kind": draft["kind"],
        "title": draft.get("title") or title,
        "examCode": draft.get("examCode"),
        "taxonomyNodeIds": draft["taxonomyNodeIds"],
        "languages": draft["languages"],
    }
    if draft["kind"] in NOTES:
        return {
            **common,
            "depth": draft["depth"],
            "includeExamples": draft["includeExamples"],
            "includePractice": draft["includePractice"],
        }
    return {
        **common,
        "blueprintId": draft.get("blueprintId"),
        "sections": draft["sections"],
        "layout": draft["layout"],
        "durationMinutes": draft.get("durationMinutes"),
        "sourcing": draft["sourcing"],
        "studentBatchId": draft.get("studentBatchId"),
        "setCodes": draft.get("setCodes", []),
    }


def total_questions(spec: Mapping[str, Any]) -> int:
    return sum(int(section["count"]) for section in spec.get("sections", []))


def availability(
    spec: Mapping[str, Any], in_bank: Mapping[str, int], names: Mapping[str, str]
) -> list[dict[str, Any]]:
    """Per chapter: questions the bank can supply, and the rest to be generated. The paper's questions are
    shared evenly across its chapters (paper planning weighs them properly, step 26)."""
    nodes: list[str] = list(spec["taxonomyNodeIds"])
    if spec["kind"] in NOTES:
        return []
    out: list[dict[str, Any]] = []
    for node, need in zip(nodes, split(total_questions(spec), len(nodes)), strict=True):
        bank = 0 if spec["sourcing"] == "fresh_only" else min(in_bank.get(node, 0), need)
        generate = 0 if spec["sourcing"] == "bank_only" else need - bank
        out.append({"nodeId": node, "name": names.get(node, node), "fromBank": bank, "toGenerate": generate})
    return out


# Rough sizes of the work, for the estimate on the review card (tuned against real runs in phase D).
QUESTIONS_PER_CALL = 5
_STYLE_PACK = 4_000  # rules and exemplars, cached and shared by every call for the exam
_EVIDENCE = 5_000  # retrieved passages per call
_QUESTION_OUT = {1: 400, 2: 700}  # by number of languages
_RETRY = 1.3


def work(spec: Mapping[str, Any], to_generate: int) -> dict[str, tuple[list[Usage], list[Usage]]]:
    """Per task, the (lowest, highest) token use of making this spec: lowest with the style pack cached and no
    retries, highest with nothing cached and a third of the questions made twice."""
    languages = len(spec["languages"])
    if spec["kind"] in NOTES:
        nodes = len(spec["taxonomyNodeIds"])
        out = 2_500 * (1.8 if languages > 1 else 1)
        low = [
            Usage(input_tokens=_EVIDENCE + 1_000, cache_read_tokens=_STYLE_PACK, output_tokens=int(out))
        ] * nodes
        high = [Usage(input_tokens=_EVIDENCE * 2 + _STYLE_PACK, output_tokens=int(out * _RETRY))] * nodes
        check = [Usage(input_tokens=2_000 * nodes, output_tokens=200)]
        return {
            "notes_write": (low, high),
            "verify_grounding": (check, check),
        }
    if to_generate == 0:
        return {}
    calls = math.ceil(to_generate / QUESTIONS_PER_CALL)
    per_call_out = QUESTIONS_PER_CALL * _QUESTION_OUT[min(languages, 2)]
    return {
        "generate": (
            [Usage(input_tokens=_EVIDENCE, cache_read_tokens=_STYLE_PACK, output_tokens=per_call_out)]
            * calls,
            [Usage(input_tokens=_EVIDENCE + _STYLE_PACK, output_tokens=int(per_call_out * _RETRY))] * calls,
        ),
        "verify_solve": (
            [Usage(input_tokens=1_500 * languages, output_tokens=400 * languages)] * to_generate,
            [Usage(input_tokens=1_500 * languages, output_tokens=int(400 * languages * _RETRY))]
            * to_generate,
        ),
        "verify_grounding": (
            [Usage(input_tokens=2_000, output_tokens=150)] * to_generate,
            [Usage(input_tokens=2_000, output_tokens=int(150 * _RETRY))] * to_generate,
        ),
    }


def minutes(spec: Mapping[str, Any], to_generate: int) -> float:
    """Wall-clock time: generation calls four at a time, about 45 s each, then checking."""
    if spec["kind"] in NOTES:
        return round(1 + len(spec["taxonomyNodeIds"]) * 0.75, 1)
    calls = math.ceil(to_generate / QUESTIONS_PER_CALL)
    return round(0.5 + math.ceil(calls / 4) * 0.75 + (1 if to_generate else 0), 1)
