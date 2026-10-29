"""The retrieval eval (plan v3 step 21): every query goes through retrieval as the chat sends it, and where
its answer landed is recorded. The measures and the report are in `domain/evaluation.py`."""

from collections.abc import Callable, Sequence
from typing import Protocol
from uuid import UUID

from vidyam_ai.application.retrieval import RetrievalRequest, Retrieve
from vidyam_ai.domain.evaluation import EvalQuery, Outcome, Status, answers, chapters, file_name
from vidyam_ai.domain.retrieval import Passage, Scope
from vidyam_ai.domain.sections import SyllabusNode


class EvalCorpus(Protocol):
    """Port: what the eval needs to know about a center's library."""

    async def file_names(self, org_id: UUID) -> dict[UUID, str]:
        """Each file's name, by source id."""
        ...

    async def searchable(self, org_id: UUID) -> set[UUID]:
        """Files with at least one passage in the search index."""
        ...

    async def nodes(self, org_id: UUID) -> list[SyllabusNode]: ...


class EvaluateRetrieval:
    def __init__(self, retrieve: Retrieve, corpus: EvalCorpus) -> None:
        self._retrieve = retrieve
        self._corpus = corpus

    async def execute(
        self,
        org_id: UUID,
        queries: Sequence[EvalQuery],
        *,
        rerank: bool = True,
        progress: Callable[[Outcome], None] | None = None,
    ) -> list[Outcome]:
        names = await self._corpus.file_names(org_id)
        searchable = {file_name(names[source]) for source in await self._corpus.searchable(org_id)}
        chapter_of = chapters(await self._corpus.nodes(org_id))

        def rank(passages: Sequence[Passage], query: EvalQuery) -> int | None:
            return next(
                (
                    n
                    for n, passage in enumerate(passages, 1)
                    if answers(query.expect, names.get(passage.source_id, ""), passage.text)
                ),
                None,
            )

        outcomes: list[Outcome] = []
        for query in queries:
            status: Status = (
                "unanswerable"
                if not query.expect
                else "answerable"
                if any(file_name(e.file) in searchable for e in query.expect)
                else "waiting"
            )
            found = await self._retrieve.execute(RetrievalRequest(org_id, query.query, rerank=rerank))
            chapter_rank: int | None = None
            chapter = chapter_of.get(query.node or "")
            if status == "answerable" and chapter is not None:
                scoped = await self._retrieve.execute(
                    RetrievalRequest(
                        org_id, query.query, scope=Scope(node_ids=(chapter,)), rerank=False, window=0
                    )
                )
                chapter_rank = rank(scoped.ranked, query)
            pick_rank = next(
                (
                    n
                    for n, hit in enumerate(found.hits, 1)
                    if answers(query.expect, names.get(hit.passage.source_id, ""), hit.context)
                ),
                None,
            )
            outcome = Outcome(
                query=query,
                status=status,
                candidate_rank=rank(found.ranked, query),
                chapter_rank=chapter_rank,
                pick_rank=pick_rank,
                picks=len(found.hits),
                top_relevance=found.hits[0].relevance if found.hits else None,
                timings_ms=found.timings_ms,
            )
            outcomes.append(outcome)
            if progress:
                progress(outcome)
        return outcomes
