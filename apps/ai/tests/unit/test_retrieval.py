"""Choosing passages (plan v3 §7 step 3, step 20): one copy of each passage, rerank, picks spread across
files, neighbours from the same section, and search that keeps working without a model server."""

import math
from collections.abc import Mapping, Sequence
from uuid import UUID, uuid4

import pytest
from vidyam_ai.application.embedding import ModelServerError
from vidyam_ai.application.retrieval import RetrievalRequest, Retrieve, SearchQuery
from vidyam_ai.domain.embeddings import EmbeddingVersion
from vidyam_ai.domain.retrieval import (
    Candidate,
    Fusion,
    Passage,
    Scope,
    Tuning,
    drop_duplicates,
    neighbours,
    pick,
    query_language,
    rerank_text,
    shorten,
)
from vidyam_ai.infrastructure.cache import CachedEmbedder, CachedReranker

FILE_A, FILE_B, HINDI_EDITION, ENGLISH_EDITION = (uuid4() for _ in range(4))
EDITIONS = uuid4()  # the parallel group of the two editions


def passage(
    source: UUID,
    position: int,
    text: str = "text",
    *,
    heading: str | None = "Motion › Acceleration",
    language: str = "hi",
    group: UUID | None = None,
) -> Passage:
    return Passage(
        uuid4(), source, position, text, heading, "Notes", position + 1, position + 1, None, language,
        "prose", "notes", "own", group, None,
    )  # fmt: skip


def at(angle: float) -> list[float]:
    """A unit vector at `angle` radians from (1, 0, 0): cos(angle) is its similarity to it."""
    return [math.cos(angle), math.sin(angle), 0.0]


def similar(cosine: float) -> list[float]:
    return at(math.acos(cosine))


def candidate(p: Passage, vector: list[float], fused: float = 1.0) -> Candidate:
    return Candidate(p, fused, vector)


def test_a_passage_in_both_editions_is_kept_once_in_the_teachers_language() -> None:
    english = candidate(passage(ENGLISH_EDITION, 2, language="en", group=EDITIONS), at(0))
    other = candidate(passage(FILE_A, 0), at(1.4))
    hindi = candidate(passage(HINDI_EDITION, 3, language="hi", group=EDITIONS), similar(0.85))

    assert drop_duplicates([english, other, hindi], "hi") == [hindi, other]  # at the English one's rank
    assert drop_duplicates([english, other, hindi], None) == [english, other]
    assert drop_duplicates([english, other, hindi], "en") == [english, other]


def test_only_a_near_exact_copy_counts_as_the_same_passage_across_unrelated_files() -> None:
    first = candidate(passage(FILE_A, 0), at(0))
    related = candidate(passage(FILE_B, 0), similar(0.85))
    copy = candidate(passage(FILE_B, 1), similar(0.97))
    assert drop_duplicates([first, related, copy], None) == [first, related]
    # within one file, neighbours overlap in topic but are different text
    same_file = candidate(passage(FILE_A, 1), similar(0.97))
    assert drop_duplicates([first, same_file], None) == [first, same_file]


def test_the_reranker_reads_the_headings_and_the_start_of_a_long_passage() -> None:
    hindi = "त्वरण वेग में परिवर्तन की दर है। " * 40
    short = shorten(hindi, 60)
    assert short.endswith(" …") and short.startswith("त्वरण") and len(short) < len(hindi)
    assert not short.removesuffix(" …").endswith(" ")  # cut between words
    assert shorten("a short text", 60) == "a short text"
    text = rerank_text(passage(FILE_A, 0, hindi), 80)
    assert text.startswith("Motion › Acceleration\nत्वरण")


def test_picks_spread_across_files_and_avoid_saying_the_same_thing_twice() -> None:
    a = [candidate(passage(FILE_A, n), at(0.6 * n)) for n in range(5)]
    b = [candidate(passage(FILE_B, n), at(2.0 + 0.6 * n)) for n in range(2)]
    pool = [*a, *b]
    relevance = [0.95, 0.9, 0.85, 0.8, 0.75, 0.5, 0.4]

    four = pick(pool, relevance, 4, diversity=0.0, max_per_source=3)
    assert [pool[i].passage.source_id for i in four] == [FILE_A, FILE_A, FILE_A, FILE_B]
    # a file over its share is drawn on again only when nothing else is left
    seven = pick(pool, relevance, 7, diversity=0.0, max_per_source=3)
    assert sorted(seven) == list(range(7)) and seven[3:5] == [5, 6]

    repeat = candidate(passage(FILE_B, 9), at(0.01))  # says what the best one says
    pool = [a[0], repeat, a[2]]
    assert pick(pool, [0.9, 0.85, 0.7], 2, diversity=0.0, max_per_source=3) == [0, 1]
    assert pick(pool, [0.9, 0.85, 0.7], 2, diversity=0.5, max_per_source=3) == [0, 2]


def test_neighbours_come_from_the_same_section_and_are_shown_once() -> None:
    chapter = [passage(FILE_A, n, f"p{n}", heading="Motion › Speed") for n in range(4)]
    after_heading = passage(FILE_A, 4, "p4", heading="Motion › Acceleration")
    subsection = passage(FILE_A, 5, "p5", heading="Motion › Acceleration › Uniform")
    nearby = [*chapter, after_heading, subsection]

    sides = neighbours([chapter[1], chapter[3]], nearby, 1)
    assert sides[0] == ((chapter[0],), (chapter[2],))
    assert sides[1] == ((), ())  # p2 is beside the first hit already; p4 starts another section
    assert neighbours([after_heading], nearby, 2) == [((), (subsection,))]


def test_a_query_in_devanagari_asks_for_the_hindi_edition() -> None:
    assert query_language("त्वरण का SI मात्रक") == "hi"
    assert query_language("newton ka teesra niyam") is None
    assert query_language("What is acceleration?") is None


class FakeIndex:
    def __init__(self, found: list[Candidate]) -> None:
        self.found = found
        self.queries: list[SearchQuery] = []

    async def search(
        self, org_id: UUID, query: SearchQuery, scope: Scope, fusion: Fusion, limit: int
    ) -> list[Candidate]:
        self.queries.append(query)
        return self.found[:limit]

    async def nearby(self, org_id: UUID, around: Sequence[Passage], window: int) -> list[Passage]:
        return []


class FakeEmbedder:
    version = EmbeddingVersion("test", 3)

    def __init__(self, *, down: bool = False) -> None:
        self.down = down
        self.texts: list[str] = []

    async def ready(self) -> bool:
        return not self.down

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        if self.down:
            raise ModelServerError("embedding server: connection refused", retryable=True)
        self.texts.extend(texts)
        return [at(0.1 * len(text)) for text in texts]


class FakeReranker:
    def __init__(self, scores: Mapping[str, float] | None = None) -> None:
        self.scores = scores
        self.read: list[str] = []

    async def ready(self) -> bool:
        return self.scores is not None

    async def rerank(self, query: str, documents: Sequence[str]) -> list[float]:
        if self.scores is None:
            raise ModelServerError("rerank server: connection refused", retryable=True)
        self.read.extend(documents)
        return [next(s for word, s in self.scores.items() if word in document) for document in documents]


def found() -> list[Candidate]:
    sources = (FILE_A, FILE_B, HINDI_EDITION, ENGLISH_EDITION)
    texts = ("acceleration unit", "distance", "velocity time graph", "photosynthesis")
    return [
        candidate(passage(source, 0, text), at(n), fused=1 / (n + 1))
        for n, (source, text) in enumerate(zip(sources, texts, strict=True))
    ]


ORG = uuid4()


async def test_hits_are_what_the_reranker_says_answers_the_query() -> None:
    reranker = FakeReranker({"acceleration": 0.4, "distance": 0.01, "velocity": 0.9, "photo": 0.99})
    retrieve = Retrieve(FakeIndex(found()), FakeEmbedder(), reranker, Tuning(rerank=3, rerank_tokens=100))
    result = await retrieve.execute(RetrievalRequest(ORG, "what is acceleration", diversity=0))
    assert [hit.passage.text for hit in result.hits] == ["velocity time graph", "acceleration unit"]
    assert [hit.relevance for hit in result.hits] == [0.9, 0.4]
    assert len(reranker.read) == 3 and reranker.read[0] == "Motion › Acceleration\nacceleration unit"
    assert result.dense and result.reranked and result.candidates == 4 and not result.notes
    assert set(result.timings_ms) == {"embed", "search", "rerank", "neighbours"}


async def test_without_the_embedding_server_search_uses_keywords_only() -> None:
    index = FakeIndex(found())
    retrieve = Retrieve(index, FakeEmbedder(down=True), FakeReranker({"": 0.9}), Tuning())
    result = await retrieve.execute(RetrievalRequest(ORG, "त्वरण का मात्रक"))
    assert index.queries[0].vector is None and index.queries[0].lex == "त्वरण का मात्रक"
    assert not result.dense and result.reranked and len(result.hits) == 4
    assert result.notes[0].startswith("searched by keywords only")


async def test_without_the_rerank_server_the_fused_order_stands() -> None:
    retrieve = Retrieve(FakeIndex(found()), FakeEmbedder(), FakeReranker(None), Tuning())
    result = await retrieve.execute(RetrievalRequest(ORG, "acceleration", limit=3, diversity=0))
    assert [hit.passage.text for hit in result.hits] == [
        "acceleration unit",
        "distance",
        "velocity time graph",
    ]
    assert all(hit.relevance is None for hit in result.hits)
    assert not result.reranked and result.notes[0].startswith("not reranked")


class MemoryCache:
    def __init__(self) -> None:
        self.data: dict[str, bytes] = {}

    async def get_many(self, keys: Sequence[str]) -> list[bytes | None]:
        return [self.data.get(key) for key in keys]

    async def set_many(self, items: Mapping[str, bytes], ttl_s: int) -> None:
        self.data.update(items)


async def test_query_vectors_and_rerank_scores_are_remembered() -> None:
    cache = MemoryCache()
    inner = FakeEmbedder()
    embedder = CachedEmbedder(inner, cache)
    first = await embedder.embed(["a", "bb"])
    again = await embedder.embed(["bb", "ccc", "a"])
    assert inner.texts == ["a", "bb", "ccc"]  # only the new text went to the model
    assert again[0] == pytest.approx(first[1]) and again[2] == pytest.approx(first[0])

    scorer = FakeReranker({"x": 0.25, "y": 0.75})
    reranker = CachedReranker(scorer, cache, "rerank-model")
    assert await reranker.rerank("q", ["x", "y"]) == [0.25, 0.75]
    assert await reranker.rerank("q", ["y", "x", "xy"]) == [0.75, 0.25, 0.25]
    assert scorer.read == ["x", "y", "xy"]
    assert await reranker.rerank("other query", ["x"]) == [0.25] and scorer.read[-1] == "x"
