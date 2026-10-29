"""Retrieval (plan v3 §7 step 3, step 20): the passages of a center's material that answer a query, for
doubts in the chat (step 23) and evidence for generation (step 26). How passages are chosen is in
`domain/retrieval.py`; this runs the stages against the index and the model servers.

Search keeps working when a model server is down, with less: without the embedding server it searches by
keywords only, and without the rerank server it keeps the fused order. The result says what was skipped.
"""

import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Protocol
from uuid import UUID

from vidyam_ai.application.embedding import Embedder, ModelServerError, Reranker
from vidyam_ai.domain.embeddings import RETRIEVE_PASSAGES, query_text
from vidyam_ai.domain.lexical import lexical
from vidyam_ai.domain.retrieval import (
    MIN_RELEVANCE,
    Candidate,
    Fusion,
    Passage,
    Scope,
    Tuning,
    drop_duplicates,
    neighbours,
    normalized,
    pick,
    query_language,
    rerank_text,
)


@dataclass(frozen=True)
class SearchQuery:
    vector: Sequence[float] | None  # None: the embedding server is down; keywords only
    lex: str
    lex_roman: str


class PassageIndex(Protocol):
    """Port: the `chunks` search index (Qdrant)."""

    async def search(
        self, org_id: UUID, query: SearchQuery, scope: Scope, fusion: Fusion, limit: int
    ) -> list[Candidate]:
        """The best `limit` passages in scope by fused rank, with their vectors."""
        ...

    async def nearby(self, org_id: UUID, around: Sequence[Passage], window: int) -> list[Passage]:
        """Passages within `window` positions of each given one, in the same file."""
        ...


@dataclass(frozen=True)
class RetrievalRequest:
    org_id: UUID
    query: str
    scope: Scope = field(default_factory=Scope)
    limit: int = 8
    language: str | None = None  # the edition to prefer (hi, en); guessed from the query when unset
    diversity: float = 0.25  # 0: relevance only
    window: int = 1  # neighbours each way (0: none)
    rerank: bool = True
    min_relevance: float = MIN_RELEVANCE
    instruction: str = RETRIEVE_PASSAGES


@dataclass(frozen=True)
class Hit:
    passage: Passage
    relevance: float | None  # the reranker's probability that it answers the query; None when not reranked
    before: tuple[Passage, ...] = ()
    after: tuple[Passage, ...] = ()

    @property
    def context(self) -> str:
        """The passage with its neighbours, in reading order."""
        return "\n\n".join(passage.text for passage in (*self.before, self.passage, *self.after))


@dataclass(frozen=True)
class Retrieved:
    hits: list[Hit]
    candidates: int  # found by hybrid search, before copies were dropped
    dense: bool  # searched by meaning as well as keywords
    reranked: bool
    # Hybrid search's candidates after copies were dropped, best first: what the reranker reads from. For
    # measuring search (step 21) and for seeing why a passage wasn't picked.
    ranked: tuple[Passage, ...] = ()
    notes: tuple[str, ...] = ()  # what was skipped, and why
    timings_ms: dict[str, float] = field(default_factory=dict[str, float])


class Retrieve:
    def __init__(self, index: PassageIndex, embedder: Embedder, reranker: Reranker, tuning: Tuning) -> None:
        self._index = index
        self._embedder = embedder
        self._reranker = reranker
        self._tuning = tuning

    async def execute(self, request: RetrievalRequest) -> Retrieved:
        tuning = self._tuning
        notes: list[str] = []
        timings: dict[str, float] = {}
        started = time.perf_counter()

        def lap(stage: str) -> None:
            nonlocal started
            now = time.perf_counter()
            timings[stage] = round((now - started) * 1000, 1)
            started = now

        vector: list[float] | None = None
        try:
            [vector] = await self._embedder.embed([query_text(request.instruction, request.query)])
        except ModelServerError as error:
            notes.append(f"searched by keywords only: {error}")
        lap("embed")
        lex, lex_roman = lexical(request.query)
        found = await self._index.search(
            request.org_id,
            SearchQuery(vector, lex, lex_roman),
            request.scope,
            tuning.fusion,
            tuning.candidates,
        )
        unique = drop_duplicates(found, request.language or query_language(request.query))
        pool = unique
        lap("search")

        scores: list[float] | None = None
        if request.rerank and tuning.rerank > 0 and pool:
            reading = pool[: tuning.rerank]
            try:
                scores = await self._reranker.rerank(
                    request.query, [rerank_text(c.passage, tuning.rerank_tokens) for c in reading]
                )
                pool = reading
            except ModelServerError as error:
                notes.append(f"not reranked: {error}")
            lap("rerank")
        if scores is None:
            relevance = normalized([candidate.fused for candidate in pool])
        else:
            relevant = [i for i, score in enumerate(scores) if score >= request.min_relevance]
            pool, relevance = [pool[i] for i in relevant], [scores[i] for i in relevant]

        chosen = pick(
            pool, relevance, request.limit, diversity=request.diversity, max_per_source=tuning.max_per_source
        )
        picked = [pool[i].passage for i in chosen]
        nearby = await self._index.nearby(request.org_id, picked, request.window) if request.window else []
        sides = neighbours(picked, nearby, request.window)
        hits = [
            Hit(passage, relevance[i] if scores is not None else None, before, after)
            for i, passage, (before, after) in zip(chosen, picked, sides, strict=True)
        ]
        lap("neighbours")
        return Retrieved(
            hits=hits,
            candidates=len(found),
            ranked=tuple(candidate.passage for candidate in unique),
            dense=vector is not None,
            reranked=scores is not None,
            notes=tuple(notes),
            timings_ms=timings,
        )
