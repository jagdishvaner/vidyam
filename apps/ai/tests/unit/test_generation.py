"""Making papers and notes (plan v3 §7, step 26): the slot plan, the fast checks and assembly in code, and the
use cases against an in-memory bank and search, with the stub model answering through the real gateway."""

from collections import Counter
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import pytest
from vidyam_ai.application.generation import (
    AssemblePaper,
    BankQuestion,
    CheckAnswers,
    Job,
    NewQuestion,
    Node,
    PlanNotes,
    PlanPaper,
    Run,
    WriteNotesSection,
    WriteQuestions,
    assemble_notes,
)
from vidyam_ai.application.llm_gateway import LlmGateway
from vidyam_ai.application.retrieval import Hit, RetrievalRequest, Retrieved
from vidyam_ai.domain.generation import (
    NO_BANK,
    NO_EVIDENCE,
    answers_agree,
    assemble,
    check_question,
    groups,
    message_id,
    option_order,
    plan_slots,
    seeded,
    summary,
)
from vidyam_ai.domain.llm import Family, PromptTemplate, Route
from vidyam_ai.domain.retrieval import Passage
from vidyam_ai.infrastructure.llm.stub import StubProvider

from tests.unit.test_llm_gateway import MODELS, Batches, Ledger

ORG, OWNER, RUN, DOC = uuid4(), uuid4(), uuid4(), uuid4()
MOTION, FORCE, LIGHT, MOMENTUM = (str(uuid4()) for _ in range(4))
SOURCE = uuid4()
NODES = {
    MOTION: Node(MOTION, "Motion", "गति", "science/physics/motion"),
    FORCE: Node(FORCE, "Force and Laws of Motion", "बल तथा गति के नियम", "science/physics/force"),
    LIGHT: Node(LIGHT, "Light", "प्रकाश", "science/physics/light"),
    MOMENTUM: Node(MOMENTUM, "Momentum", "संवेग", "science/physics/force/momentum"),
}
MATERIAL = [
    "बल वह बाह्य कारक है जो किसी वस्तु की गति की अवस्था को बदलता है। किसी वस्तु पर 10 न्यूटन का बल लगाने से"
    " उसमें त्वरण उत्पन्न होता है।",
    "न्यूटन के गति के प्रथम नियम को जड़त्व का नियम भी कहते हैं। प्रत्येक वस्तु अपनी विरामावस्था में बनी रहती है।",
    "संवेग द्रव्यमान और वेग का गुणनफल होता है। एक किलोग्राम की गेंद 5 मीटर प्रति सेकंड से चलती है।",
]
CHUNKS = [uuid4() for _ in MATERIAL]


def spec(**fields: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "kind": "question_paper",
        "title": "Force test",
        "examCode": "rpsc_2g_p2_science",
        "blueprintId": None,
        "taxonomyNodeIds": [FORCE],
        "sections": [
            {"name": {"en": "Multiple choice"}, "qtype": "mcq_single", "count": 4, "marksEach": 2,
             "negativeMarks": 0.5, "attemptAny": None,
             "difficultyMix": {"easy": 0.5, "medium": 0.5, "hard": 0}, "scope": []},
        ],
        "languages": ["hi"],
        "layout": "single_language",
        "durationMinutes": 30,
        "sourcing": "fresh_only",
        "studentBatchId": None,
        "setCodes": [],
    }  # fmt: skip
    return {**base, **fields}


def section(qtype: str, count: int, **fields: Any) -> dict[str, Any]:
    return {"name": {"en": qtype}, "qtype": qtype, "count": count, "marksEach": 1, "negativeMarks": 0,
            "attemptAny": None, "difficultyMix": {"easy": 0.3, "medium": 0.5, "hard": 0.2}, "scope": [],
            **fields}  # fmt: skip


# --- The plan ------------------------------------------------------------------------------------------


def test_slots_follow_the_weightage_and_each_chapter_gets_its_share_of_the_mix() -> None:
    paper = spec(
        taxonomyNodeIds=[MOTION, FORCE, LIGHT], sections=[section("mcq_single", 20), section("numerical", 5)]
    )
    slots = plan_slots(paper, {MOTION: 3.0, FORCE: 1.0})  # Light has no weightage: it counts as average (2)
    first = [s for s in slots if s["sectionIndex"] == 0]
    assert len(first) == 20 and len(slots) == 25
    assert len({s["slotId"] for s in slots}) == 25
    assert Counter(s["taxonomyNodeId"] for s in first) == {MOTION: 10, LIGHT: 7, FORCE: 3}
    assert Counter(s["difficulty"] for s in first) == {2: 6, 3: 10, 4: 4}  # exactly the 30/50/20 mix
    motion = Counter(s["difficulty"] for s in first if s["taxonomyNodeId"] == MOTION)
    assert motion == {2: 3, 3: 5, 4: 2}  # spread over the chapters, not bunched
    assert all(s["state"] == "pending" and s["questionId"] is None for s in slots)


def test_a_section_keeps_to_its_scope() -> None:
    paper = spec(
        taxonomyNodeIds=[FORCE, LIGHT],
        sections=[section("mcq_single", 4, scope=["science/physics/light"]), section("mcq_single", 4)],
    )
    slots = plan_slots(paper, {}, {node: n.path for node, n in NODES.items()})
    assert {s["taxonomyNodeId"] for s in slots if s["sectionIndex"] == 0} == {LIGHT}
    assert {s["taxonomyNodeId"] for s in slots if s["sectionIndex"] == 1} == {FORCE, LIGHT}


def test_open_slots_are_grouped_by_chapter_and_type_five_at_a_time() -> None:
    slots = plan_slots(spec(taxonomyNodeIds=[MOTION, FORCE], sections=[section("mcq_single", 14)]), {})
    slots[0] = {**slots[0], "state": "bank", "questionId": str(uuid4())}
    slots[1] = {**slots[1], "state": "flagged", "questionId": str(uuid4())}  # written again
    sizes = [(g[0]["taxonomyNodeId"], len(g)) for g in groups(slots)]
    assert sizes == [(MOTION, 5), (MOTION, 1), (FORCE, 5), (FORCE, 2)]


# --- Fast checks ---------------------------------------------------------------------------------------

GOOD = {
    "hi": {"stem": "बल का मात्रक क्या है?", "options": [{"key": k, "text": t} for k, t in
           zip("ABCD", ["न्यूटन", "जूल", "वाट", "पास्कल"], strict=True)], "solution": "$F = ma$"},
    "en": {"stem": "What is the unit of force?", "options": [{"key": k, "text": t} for k, t in
           zip("ABCD", ["newton", "joule", "watt", "pascal"], strict=True)], "solution": "$F = ma$"},
}  # fmt: skip


def test_a_sound_question_passes_the_fast_checks() -> None:
    assert check_question("mcq_single", GOOD, {"kind": "options", "keys": ["A"]}, ["hi", "en"], 1) == []


ONE = {"kind": "options", "keys": ["A"]}


@pytest.mark.parametrize(
    ("content", "answer", "problem"),
    [
        ({**GOOD, "hi": None}, {"kind": "options", "keys": ["A"]}, "no question text in Hindi"),
        (GOOD, {"kind": "options", "keys": ["A", "B"]}, "not exactly one correct option"),
        (GOOD, {"kind": "options", "keys": ["E"]}, "the answer isn't one of the options"),
        ({**GOOD, "hi": {**GOOD["hi"], "stem": "What is the unit of force?"}}, ONE,
         "the Hindi version isn't written in Devanagari"),
        ({**GOOD, "en": {**GOOD["en"], "solution": "$F = ma"}}, {"kind": "options", "keys": ["A"]},
         "unbalanced mathematics ($ or braces) in English"),
        ({**GOOD, "en": {**GOOD["en"], "options": GOOD["en"]["options"][:3]}}, ONE,
         "the languages have different options"),
    ],
)  # fmt: skip
def test_the_fast_checks_name_what_is_wrong(content: Any, answer: Any, problem: str) -> None:
    assert problem in check_question("mcq_single", content, answer, ["hi", "en"], 1)


def test_numeric_and_written_answers_and_citations_are_checked() -> None:
    text = {"en": {"stem": "How many?", "options": [], "solution": None}, "hi": None}
    assert check_question("numerical", text, {"kind": "unknown"}, ["en"], 1) == ["no numeric answer"]
    integer = {"kind": "numeric", "value": 2.5, "tolerance": 0}
    assert check_question("integer", text, integer, ["en"], 1) == ["the answer isn't a whole number"]
    assert check_question("short_answer", text, {"kind": "text", "modelAnswer": " "}, ["en"], 1) == [
        "no model answer"
    ]
    assert check_question("short_answer", text, {"kind": "text", "modelAnswer": "Ten."}, ["en"], 0) == [
        "cites none of the evidence"
    ]


def test_a_re_solve_agrees_on_the_same_keys_or_a_number_within_tolerance() -> None:
    assert answers_agree({"kind": "options", "keys": ["B", "A"]}, {"keys": ["A", "B"]})
    assert not answers_agree({"kind": "options", "keys": ["A"]}, {"keys": ["C"]})
    assert answers_agree({"kind": "numeric", "value": 9.8, "tolerance": 0.1}, {"value": 9.75})
    assert not answers_agree({"kind": "numeric", "value": 9.8, "tolerance": 0.1}, {"value": 10})
    assert not answers_agree({"kind": "numeric", "value": 3, "tolerance": 0}, {"value": None})


# --- Assembly ------------------------------------------------------------------------------------------


def test_none_of_the_above_stays_last_and_the_correct_option_goes_where_asked() -> None:
    texts = {"A": "newton", "B": "joule", "C": "watt", "D": "None of the above"}
    for target in range(3):
        order = option_order(list(texts), texts, seeded("x"), correct="A", target=target)
        assert order[-1] == "D" and order.index("A") == target


def test_booklet_sets_shuffle_and_spread_their_correct_answers() -> None:
    paper = spec(sections=[section("mcq_single", 8)], setCodes=["A", "B"])
    slots = plan_slots(paper, {})
    questions = {}
    for slot in slots:
        slot["questionId"], slot["state"] = str(uuid4()), "verified"
        questions[slot["questionId"]] = {"content": GOOD, "answer": {"kind": "options", "keys": ["A"]}}
    document = assemble(paper, slots, questions, seed="run-1")
    a, b = document["sets"]
    assert a["slotOrder"] == [s["slotId"] for s in slots]  # set A keeps the paper's order
    assert sorted(b["slotOrder"]) == sorted(a["slotOrder"]) and b["slotOrder"] != a["slotOrder"]
    for booklet in (a, b):  # every key A in the bank, yet each set's answers fall evenly on A–D
        where = Counter(order.index("A") for order in booklet["optionOrder"].values())
        assert where == {0: 2, 1: 2, 2: 2, 3: 2}
    assert assemble(paper, slots, questions, seed="run-1") == document  # the same every time
    assert document["sections"][0]["slotIds"] == [s["slotId"] for s in slots]


def test_the_chat_hears_what_was_made_and_message_ids_are_fixed_by_the_run() -> None:
    text = summary("question_paper", {"bank": 4, "verified": 20, "flagged": 1}, "en")
    assert (
        text
        == "Your paper is ready: 4 from your question bank, 20 new and checked, 1 flagged for you to look at."
    )
    assert summary("notes", {"insufficient_evidence": 3}, "en").startswith("I couldn't make any of it")
    assert summary("question_paper", {"verified": 2}, "hi") == "आपका प्रश्न-पत्र तैयार है: 2 नए और जाँचे हुए।"
    assert message_id(RUN, "ready") == message_id(RUN, "ready") != message_id(RUN, "failed")
    assert UUID(message_id(RUN, "ready")).version == 8


# --- Use cases, with the stub model --------------------------------------------------------------------


class Catalog:
    """The gateway's registry, with every generation task routed to the stub-answered top model."""

    async def route(self, org_id: UUID, task: str) -> Route | None:
        return Route(task, "claude-opus-5-5", "high", 32_000)

    async def model(self, model_id: str) -> Any:
        return MODELS.get(model_id)

    async def allowed_model_ids(self, org_id: UUID) -> list[str]:
        return []

    async def prompt(self, task: str, family: Family) -> PromptTemplate | None:
        bodies = {
            "generate": "Questions for {{exam}} in {{languages}}. Terms: {{glossary}}",
            "verify_grounding": "Check these {{kind}}: {{items}}",
            "verify_solve": "Solve: {{question}}",
            "notes_write": "Notes for {{exam}}. Terms: {{glossary}}",
        }
        return PromptTemplate(task, "any", 1, bodies[task]) if task in bodies and family == "any" else None


class Store:
    def __init__(self, made: dict[str, Any], bank: list[BankQuestion] | None = None) -> None:
        self.the_run = Run(
            RUN, DOC, None, f"GeneratePaper:{RUN}", made["kind"], made["title"], made, None, OWNER, "en"
        )
        self.bank_rows = bank or []
        self.saved: dict[str, NewQuestion] = {}
        self.checks: dict[str, tuple[str, dict[str, Any]]] = {}

    async def run(self, org_id: UUID, run_id: UUID) -> Run | None:
        return self.the_run

    async def weights(self, org_id: UUID, exam_id: UUID | None, node_ids: Any) -> dict[str, float]:
        return {}

    async def nodes(self, org_id: UUID, ids: Any) -> dict[str, Node]:
        return {i: NODES[i] for i in ids if i in NODES}

    async def children(self, org_id: UUID, node_id: str) -> list[Node]:
        return [NODES[MOMENTUM]] if node_id == FORCE else []

    async def bank(self, org_id: UUID, node_id: str, qtype: str, languages: Any, *, exclude: Any,
                   student_batch_id: UUID | None, limit: int) -> list[BankQuestion]:  # fmt: skip
        return [q for q in self.bank_rows if q.id not in exclude][:limit]

    async def glossary(self, org_id: UUID, node_ids: Any) -> list[tuple[str, str]]:
        return [("force", "बल")]

    async def save_question(self, org_id: UUID, question: NewQuestion) -> UUID:
        question_id = uuid4()
        self.saved[str(question_id)] = question
        return question_id

    async def questions(self, org_id: UUID, ids: Any) -> dict[str, dict[str, Any]]:
        out = {}
        for i in map(str, ids):
            if q := self.saved.get(i):
                out[i] = {
                    "qtype": q.qtype,
                    "content": q.content,
                    "answer": q.answer,
                    "provenance": q.provenance,
                }
        return out

    async def checked(self, org_id: UUID, question_id: UUID, status: str, verification: Any) -> None:
        self.checks[str(question_id)] = (status, dict(verification))

    async def file_names(self, org_id: UUID, source_ids: Any) -> dict[UUID, str]:
        return {SOURCE: "files/physics-motion-force-hi.pdf"}

    async def passages(self, org_id: UUID, chunk_ids: Any) -> list[str]:
        texts = {str(c): f"बल › गति के नियम\n{t}" for c, t in zip(CHUNKS, MATERIAL, strict=True)}
        return [texts[c] for c in chunk_ids if c in texts]

    async def cost(self, org_id: UUID, workflow_id: str) -> Decimal:
        return Decimal(0)


class Search:
    """The chapter Force has the three passages above; nothing else has material."""

    def __init__(self) -> None:
        self.requests: list[RetrievalRequest] = []

    async def execute(self, request: RetrievalRequest) -> Retrieved:
        self.requests.append(request)
        if UUID(FORCE) not in request.scope.node_ids and UUID(MOMENTUM) not in request.scope.node_ids:
            return Retrieved([], 0, True, True)
        hits = [
            Hit(Passage(chunk, SOURCE, n, text, "बल › गति के नियम", "नोट्स", 5 + n, 5 + n, str(41 + n), "hi",
                        "prose", "notes", "own", None, UUID(FORCE)), 0.9)
            for n, (chunk, text) in enumerate(zip(CHUNKS, MATERIAL, strict=True))
            if chunk not in request.scope.exclude_chunk_ids
        ]  # fmt: skip
        return Retrieved(hits, len(hits), True, True)


def models(tmp_path: Path) -> LlmGateway:
    return LlmGateway(Catalog(), Ledger(), Batches(), {}, stub=StubProvider(tmp_path))  # type: ignore[arg-type]


JOB = Job(ORG, RUN, OWNER, None)


async def test_questions_are_written_from_the_evidence_checked_and_banked(tmp_path: Path) -> None:
    made = spec()
    store, search, llm = Store(made), Search(), models(tmp_path)
    slots = await PlanPaper(store).execute(ORG, RUN)
    written = await WriteQuestions(store, llm, search).execute(JOB, slots, used=[], feedback={}, final=False)

    assert [s["state"] for s in written.slots] == ["generated"] * 4
    assert search.requests[0].scope.node_ids == (UUID(FORCE),)
    question = store.saved[written.slots[0]["questionId"]]
    assert question.content["hi"]["stem"].startswith("रिक्त स्थान भरिए:") and question.content["en"] is None
    assert question.answer["kind"] == "options" and question.provenance["chunkIds"]
    assert (question.marks, question.negative_marks, question.status) == (2.0, 0.5, "draft")
    assert set(written.chunk_ids) <= {str(c) for c in CHUNKS}

    checked = await CheckAnswers(store, llm).execute(JOB, written.slots, written.model_id)
    assert [s["state"] for s in checked] == ["verified"] * 4  # the solver found each sentence in the material
    assert all(status == "verified" for status, _ in store.checks.values())

    document = await AssemblePaper(store).execute(ORG, RUN, checked)
    assert [s["state"] for s in document["slots"]] == ["verified"] * 4


async def test_a_chapter_without_material_is_marked_not_invented(tmp_path: Path) -> None:
    store = Store(spec(taxonomyNodeIds=[LIGHT]))
    slots = await PlanPaper(store).execute(ORG, RUN)
    written = await WriteQuestions(store, models(tmp_path), Search()).execute(
        JOB, slots, used=[], feedback={}, final=True
    )
    assert {s["state"] for s in written.slots} == {"insufficient_evidence"}
    assert written.slots[0]["flags"] == [NO_EVIDENCE] and store.saved == {}


class EnglishSearch(Search):
    """The light chapter's material is only in English."""

    async def execute(self, request: RetrievalRequest) -> Retrieved:
        text = (
            "Light travels in straight lines. The speed of light in vacuum is 300000 kilometres per second."
        )
        passage = Passage(uuid4(), SOURCE, 0, text, None, "Light", 1, 1, None, "en", "prose", "notes", "own",
                          None, UUID(LIGHT))  # fmt: skip
        return Retrieved([Hit(passage, 0.9)], 1, True, True)


async def test_numeric_questions_ask_for_a_number_from_the_material(tmp_path: Path) -> None:
    store = Store(spec(sections=[section("numerical", 2)]))
    slots = await PlanPaper(store).execute(ORG, RUN)
    written = await WriteQuestions(store, models(tmp_path), Search()).execute(
        JOB, slots, used=[], feedback={}, final=False
    )
    assert {s["state"] for s in written.slots} == {"generated"}
    answers = [store.saved[s["questionId"]].answer for s in written.slots]
    assert {a["value"] for a in answers} <= {10.0, 5.0} and answers[0]["tolerance"] == 0.1


async def test_a_failed_question_stays_out_of_the_bank_until_the_last_try(tmp_path: Path) -> None:
    store = Store(spec(taxonomyNodeIds=[LIGHT]))  # a Hindi paper, but the stub can't translate
    write = WriteQuestions(store, models(tmp_path), EnglishSearch())
    slots = await PlanPaper(store).execute(ORG, RUN)
    first = await write.execute(JOB, slots, used=[], feedback={}, final=False)
    assert {s["state"] for s in first.slots} == {"flagged"} and store.saved == {}
    assert "the Hindi version isn't written in Devanagari" in first.slots[0]["flags"]

    feedback = {s["slotId"]: s["flags"] for s in first.slots}
    last = await write.execute(JOB, first.slots, used=[], feedback=feedback, final=True)
    assert {s["state"] for s in last.slots} == {"flagged"}  # kept, for the teacher to fix or replace
    assert {store.saved[s["questionId"]].status for s in last.slots} == {"flagged"}


async def test_the_bank_fills_first_and_bank_only_papers_say_what_is_missing(tmp_path: Path) -> None:
    bank = [BankQuestion(uuid4(), 2), BankQuestion(uuid4(), 3)]
    store = Store(spec(sourcing="bank_only"), bank)
    slots = await PlanPaper(store).execute(ORG, RUN)
    assert [s["state"] for s in slots] == ["bank", "bank", "insufficient_evidence", "insufficient_evidence"]
    assert {s["questionId"] for s in slots[:2]} == {str(q.id) for q in bank}
    assert slots[2]["flags"] == [NO_BANK]
    assert groups(slots) == []  # nothing left to write


async def test_notes_are_written_per_topic_with_their_sources(tmp_path: Path) -> None:
    notes = {"kind": "notes", "title": "Force notes", "examCode": None, "taxonomyNodeIds": [FORCE, LIGHT],
             "languages": ["hi"], "depth": "standard", "includeExamples": True,
             "includePractice": False}  # fmt: skip
    store, llm = Store(notes), models(tmp_path)
    sections = await PlanNotes(store).execute(ORG, RUN)
    assert [s["nodeId"] for s in sections] == [MOMENTUM, LIGHT]  # Force's topic; Light has none

    write = WriteNotesSection(store, llm, Search())
    first = await write.execute(JOB, sections[0], used=[], feedback=[], final=False)
    second = await write.execute(JOB, sections[1], used=[], feedback=[], final=False)
    assert first.section["state"] == "verified" and "[1]" in first.section["body"]["hi"]
    assert first.section["citations"][0]["filename"] == "physics-motion-force-hi.pdf"
    assert second.section["state"] == "insufficient_evidence"
    document = assemble_notes(notes, [first.section, second.section])
    assert [s["state"] for s in document["sections"]] == ["verified", "insufficient_evidence"]
