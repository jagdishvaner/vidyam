"""Qdrant adapter for the search index: writes through the collection aliases (`chunks`, `questions`), so a
re-built collection takes over without code changes. Every delete is scoped to its organization."""

from collections.abc import Mapping, Sequence
from typing import Any
from uuid import UUID

from qdrant_client import AsyncQdrantClient, models

from vidyam_ai.application.indexing import Point
from vidyam_ai.infrastructure.qdrant.collections import DENSE


class QdrantSearchIndex:
    def __init__(self, client: AsyncQdrantClient) -> None:
        self._client = client

    async def upsert(self, collection: str, points: Sequence[Point]) -> None:
        if not points:
            return
        await self._client.upsert(
            collection,
            points=[
                models.PointStruct(
                    id=str(point.id), vector={DENSE: point.vector}, payload=dict(point.payload)
                )
                for point in points
            ],
            wait=True,
        )

    async def delete_source(self, org_id: UUID, source_id: UUID, *, keep: Sequence[UUID] = ()) -> None:
        conditions: list[models.Condition] = [
            models.FieldCondition(key="org_id", match=models.MatchValue(value=str(org_id))),
            models.FieldCondition(key="source_id", match=models.MatchValue(value=str(source_id))),
        ]
        stale = models.Filter(
            must=conditions,
            must_not=[models.HasIdCondition(has_id=[str(point) for point in keep])] if keep else None,
        )
        await self._client.delete("chunks", points_selector=models.FilterSelector(filter=stale), wait=True)

    async def delete(self, collection: str, ids: Sequence[UUID]) -> None:
        if ids:
            await self._client.delete(
                collection, points_selector=models.PointIdsList(points=[str(i) for i in ids]), wait=True
            )

    async def set_payload(self, collection: str, ids: Sequence[UUID], payload: Mapping[str, Any]) -> None:
        if ids:
            await self._client.set_payload(
                collection, payload=dict(payload), points=[str(i) for i in ids], wait=True
            )
