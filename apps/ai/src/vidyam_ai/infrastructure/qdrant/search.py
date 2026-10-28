"""Qdrant adapter for retrieval: one hybrid query (meaning and both keyword forms, fused by weighted RRF
inside Qdrant), and the neighbours of the passages picked. Reads through the `chunks` alias, always within
one organization."""

from collections.abc import Mapping, Sequence
from typing import Any
from uuid import UUID

from qdrant_client import AsyncQdrantClient, models

from vidyam_ai.application.retrieval import SearchQuery
from vidyam_ai.domain.retrieval import Candidate, Fusion, Passage, Scope
from vidyam_ai.infrastructure.qdrant.collections import DENSE

# int8 copies find the candidates, full vectors on disk re-score them (plan v3 §5).
_DENSE_PARAMS = models.SearchParams(
    quantization=models.QuantizationSearchParams(rescore=True, oversampling=2.0)
)
_PASSAGE_FIELDS = [
    "source_id", "position", "text", "heading_path", "title", "page_start", "page_end", "page_label",
    "language", "chunk_kind", "source_kind", "licence", "parallel_group_id", "primary_node_id",
]  # fmt: skip


def _any(key: str, values: Sequence[object]) -> models.FieldCondition:
    return models.FieldCondition(key=key, match=models.MatchAny(any=[str(value) for value in values]))


def _org(org_id: UUID) -> models.FieldCondition:
    return models.FieldCondition(key="org_id", match=models.MatchValue(value=str(org_id)))


def scope_filter(org_id: UUID, scope: Scope) -> models.Filter:
    must: list[models.Condition] = [_org(org_id)]
    for key, values in (
        ("taxonomy_node_ids", scope.node_ids),
        ("language", scope.languages),
        ("licence", scope.licences),
        ("source_kind", scope.source_kinds),
        ("chunk_kind", scope.chunk_kinds),
        ("source_id", scope.source_ids),
    ):
        if values:
            must.append(_any(key, values))
    excluded = [str(chunk) for chunk in scope.exclude_chunk_ids]
    return models.Filter(
        must=must, must_not=[models.HasIdCondition(has_id=list(excluded))] if excluded else None
    )


def _uuid(value: Any) -> UUID | None:
    return UUID(str(value)) if value else None


def _passage(point_id: models.ExtendedPointId, payload: Mapping[str, Any]) -> Passage:
    return Passage(
        chunk_id=UUID(str(point_id)),
        source_id=UUID(str(payload["source_id"])),
        position=int(payload["position"]),
        text=str(payload["text"]),
        heading_path=payload.get("heading_path"),
        title=payload.get("title"),
        page_start=payload.get("page_start"),
        page_end=payload.get("page_end"),
        page_label=payload.get("page_label"),
        language=str(payload["language"]),
        chunk_kind=str(payload["chunk_kind"]),
        source_kind=str(payload["source_kind"]),
        licence=str(payload["licence"]),
        parallel_group_id=_uuid(payload.get("parallel_group_id")),
        primary_node_id=_uuid(payload.get("primary_node_id")),
    )


def _dense(vector: models.VectorStructOutput | None) -> list[float]:
    dense = vector.get(DENSE) if isinstance(vector, dict) else None
    if not isinstance(dense, list) or not dense:
        raise ValueError("a point came back without its dense vector")
    values = [x for x in dense if isinstance(x, float)]
    if len(values) != len(dense):
        raise ValueError("a point's dense vector isn't a list of numbers")
    return values


class QdrantPassageIndex:
    def __init__(self, client: AsyncQdrantClient) -> None:
        self._client = client

    async def search(
        self, org_id: UUID, query: SearchQuery, scope: Scope, fusion: Fusion, limit: int
    ) -> list[Candidate]:
        where = scope_filter(org_id, scope)
        searches: list[tuple[models.Prefetch, float]] = []
        if query.vector is not None and fusion.dense > 0:
            dense = models.Prefetch(
                query=list(query.vector),
                using=DENSE,
                filter=where,
                params=_DENSE_PARAMS,
                limit=fusion.dense_depth,
            )
            searches.append((dense, fusion.dense))
        for field, text, weight in (
            ("lex", query.lex, fusion.lex),
            ("lex_roman", query.lex_roman, fusion.lex_roman),
        ):
            if text.strip() and weight > 0:
                keywords = models.Prefetch(
                    query=models.TextQuery(text=text), using=field, filter=where, limit=fusion.keyword_depth
                )
                searches.append((keywords, weight))
        if not searches:
            return []
        response = await self._client.query_points(
            "chunks",
            prefetch=[search for search, _ in searches],
            query=models.RrfQuery(rrf=models.Rrf(k=fusion.k, weights=[weight for _, weight in searches])),
            limit=limit,
            with_payload=models.PayloadSelectorInclude(include=_PASSAGE_FIELDS),
            with_vectors=[DENSE],
        )
        return [
            Candidate(_passage(point.id, point.payload or {}), point.score, _dense(point.vector))
            for point in response.points
        ]

    async def nearby(self, org_id: UUID, around: Sequence[Passage], window: int) -> list[Passage]:
        if not around or window < 1:
            return []
        places: list[models.Condition] = [
            models.Filter(
                must=[
                    models.FieldCondition(key="source_id", match=models.MatchValue(value=str(p.source_id))),
                    models.FieldCondition(
                        key="position", range=models.Range(gte=p.position - window, lte=p.position + window)
                    ),
                ]
            )
            for p in around
        ]
        points, _ = await self._client.scroll(
            "chunks",
            scroll_filter=models.Filter(must=[_org(org_id)], should=places),
            limit=len(around) * (2 * window + 1),
            with_payload=models.PayloadSelectorInclude(include=_PASSAGE_FIELDS),
            with_vectors=False,
        )
        return [_passage(point.id, point.payload or {}) for point in points]
