"""The retrieval eval (plan v3 step 21): when a passage counts as the answer, the rates over queries, and a
run through retrieval."""

from uuid import UUID, uuid4

from vidyam_ai.application.evaluation import EvaluateRetrieval
from vidyam_ai.application.retrieval import Retrieve
from vidyam_ai.domain.evaluation import (
    EvalQuery,
    Expected,
    Outcome,
    Status,
    answers,
    chapters,
    parse_queries,
    report,
    summarize,
)
from vidyam_ai.domain.retrieval import Tuning
from vidyam_ai.domain.sections import SyllabusNode

from tests.unit.test_retrieval import FakeEmbedder, FakeIndex, FakeReranker, at, candidate, passage

PHRASE = Expected("physics-motion-force-hi.pdf", "वेग-समय ग्राफ का ढाल त्वरण बताता है")


def test_a_passage_answers_when_it_is_from_the_file_and_holds_the_phrase() -> None:
    text = "पहले की बात।  वेग-समय ग्राफ का\nढाल त्वरण बताता है और आगे।"
    assert answers([PHRASE], "files/physics-motion-force-hi.pdf", text)  # whitespace doesn't matter
    assert not answers([PHRASE], "physics-work-energy-hi.pdf", text)  # the same words in another file
    assert answers([PHRASE], "physics-motion-force-hi.pdf", "अंत में: वेग-समय ग्राफ का ढाल")  # split chunk
    assert not answers([PHRASE], "physics-motion-force-hi.pdf", "वेग-समय")


def test_queries_without_an_answer_parse_with_nothing_expected() -> None:
    [known, unknown] = parse_queries(
        [
            {
                "id": "a",
                "query": "q",
                "lang": "hi",
                "node": "s/c",
                "expect": [{"file": "f.pdf", "phrase": "p"}],
            },
            {"id": "b", "query": "q", "lang": "en"},
        ]
    )
    assert known.expect == (Expected("f.pdf", "p"),) and known.node == "s/c"
    assert unknown.expect == () and unknown.node is None


def node(path: str, level: str) -> SyllabusNode:
    return SyllabusNode(uuid4(), None, level, path, path, None)


def test_every_node_belongs_to_the_chapter_at_or_above_it() -> None:
    nodes = [
        node("science", "subject"),
        node("science/physics", "unit"),
        motion := node("science/physics/motion", "chapter"),
        node("science/physics/motion/acceleration", "topic"),
    ]
    found = chapters(nodes)
    assert found == {"science/physics/motion": motion.id, "science/physics/motion/acceleration": motion.id}


def outcome(
    lang: str,
    candidate: int | None,
    pick: int | None,
    status: Status = "answerable",
    picks: int = 3,
) -> Outcome:
    query = EvalQuery(f"{lang}-{candidate}-{pick}-{status}", "q", lang, "s/c", (PHRASE,))
    return Outcome(
        query, status, candidate, candidate, pick, picks, 0.9, {"rerank": 100.0 * (candidate or 1)}
    )


def test_rates_count_answerable_queries_and_report_the_rest_apart() -> None:
    outcomes = [
        outcome("hi", 1, 1),
        outcome("hi", 4, 2),
        outcome("en", 25, None),
        outcome("en", None, None, "waiting"),
        outcome("en", None, None, "unanswerable", picks=0),
        outcome("hinglish", None, None, "unanswerable", picks=2),
    ]
    summary = summarize(outcomes, reranked=True)
    overall = summary.overall
    assert overall.queries == 3
    assert overall.recall_at == {1: 1 / 3, 5: 2 / 3, 10: 2 / 3, 20: 2 / 3}
    assert (overall.found, overall.first, overall.mrr) == (2 / 3, 1 / 3, 0.5)
    assert summary.by_language["hi"].recall_at[20] == 1 and summary.by_language["en"].recall_at[20] == 0
    assert (summary.unanswerable, summary.rejected) == (2, 1)
    assert summary.waiting == [outcomes[3].query.id] and not summary.meets_target
    assert summary.latency_ms["rerank"][0] == 100.0

    text = report(summary, outcomes, title="Demo")
    assert "recall@20 67% misses the target of 90%" in text
    assert "1 of 2 came back empty" in text and "OCR" in text
    assert outcomes[1].query.id in text and outcomes[0].query.id not in text  # only what wasn't first


class FakeCorpus:
    def __init__(self, names: dict[UUID, str], searchable: set[UUID], nodes: list[SyllabusNode]) -> None:
        self.names, self.indexed, self.tree = names, searchable, nodes

    async def file_names(self, org_id: UUID) -> dict[UUID, str]:
        return self.names

    async def searchable(self, org_id: UUID) -> set[UUID]:
        return self.indexed

    async def nodes(self, org_id: UUID) -> list[SyllabusNode]:
        return self.tree


async def test_each_query_goes_through_retrieval_and_its_answer_is_located() -> None:
    notes, other = uuid4(), uuid4()
    found = [
        candidate(passage(other, 0, "घर्षण बल गति का विरोध करता है"), at(0), fused=1.0),
        candidate(passage(notes, 3, "वेग-समय ग्राफ का ढाल त्वरण बताता है।"), at(1.2), fused=0.5),
    ]
    reranker = FakeReranker({"घर्षण": 0.01, "ढाल": 0.97})
    retrieve = Retrieve(FakeIndex(found), FakeEmbedder(), reranker, Tuning())
    corpus = FakeCorpus(
        {notes: "files/physics-motion-force-hi.pdf", other: "physics-scan.pdf"},
        {notes},
        [node("science/physics/motion", "chapter")],
    )
    queries = [
        EvalQuery("slope", "velocity-time graph slope", "en", "science/physics/motion", (PHRASE,)),
        EvalQuery("scan", "baking soda", "hi", None, (Expected("physics-scan.pdf", "बेकिंग सोडा"),)),
        EvalQuery("off", "who won the world cup", "en"),
    ]
    seen: list[str] = []
    outcomes = await EvaluateRetrieval(retrieve, corpus).execute(
        uuid4(), queries, progress=lambda o: seen.append(o.query.id)
    )
    slope, scan, off = outcomes
    assert (slope.status, slope.candidate_rank, slope.chapter_rank, slope.pick_rank) == (
        "answerable",
        2,
        2,
        1,
    )
    assert slope.top_relevance == 0.97 and slope.picks == 1
    assert scan.status == "waiting"  # its file has nothing searchable
    assert off.status == "unanswerable" and off.picks == 1  # the fake index finds something for anything
    assert seen == ["slope", "scan", "off"]
