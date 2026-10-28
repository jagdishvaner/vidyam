"""Putting a file's chunks into the search index (plan v3 §5, step 10) and keeping the index in step with
Postgres (ADR 0018).

A file is indexed from its stored vectors (the Parquet copy), never by asking the model again: every point is
written with its current payload (tags, kind, keyword forms), and points of chunks that no longer exist are
removed. Changes made elsewhere (a file removed in the API) arrive through the outbox, which `ApplyOutbox`
applies in order.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol
from uuid import UUID

from vidyam_ai.application.embedding import Embedder, VectorFiles
from vidyam_ai.application.ingestion import SourceNotFound, Sources
from vidyam_ai.domain.indexing import ChunkFacts, SourceFacts, chunk_payload


@dataclass(frozen=True)
class Point:
    id: UUID
    vector: list[float]
    payload: Mapping[str, Any]


@dataclass(frozen=True)
class OutboxItem:
    id: int
    org_id: UUID
    entity: Literal["source", "chunk", "question"]
    entity_id: UUID
    op: Literal["delete", "update_payload"]
    payload: Mapping[str, Any]


class IndexStore(Protocol):
    """Port: what indexing reads from Postgres, and what it records there."""

    async def source_facts(self, org_id: UUID, source_id: UUID) -> SourceFacts | None: ...
    async def chunks(self, org_id: UUID, source_id: UUID) -> list[ChunkFacts]: ...
    async def ancestors(self, org_id: UUID) -> dict[UUID, list[UUID]]:
        """Each syllabus node's ancestors, nearest first."""
        ...

    async def mark_indexed(self, org_id: UUID, chunk_ids: Sequence[UUID]) -> None: ...


class SearchIndex(Protocol):
    """Port: the vector index (Qdrant): the `chunks` and `questions` collections, behind their aliases."""

    async def upsert(self, collection: str, points: Sequence[Point]) -> None: ...
    async def delete_source(self, org_id: UUID, source_id: UUID, *, keep: Sequence[UUID] = ()) -> None:
        """Removes a file's points, except those listed (a re-index keeps its current chunks)."""
        ...

    async def delete(self, collection: str, ids: Sequence[UUID]) -> None: ...
    async def set_payload(self, collection: str, ids: Sequence[UUID], payload: Mapping[str, Any]) -> None: ...


class WaitingSources(Protocol):
    """Port: files whose chunks still need vectors of the current version, or a place in the index."""

    async def waiting(self, version: str, limit: int) -> list[tuple[UUID, UUID]]:
        """(organization, source) pairs of settled files: not being read now, last changed a while ago."""
        ...


class Outbox(Protocol):
    """Port: `index_outbox`, read across organizations by the AI engine only."""

    async def next(self, limit: int) -> list[OutboxItem]: ...
    async def done(self, item_id: int) -> None: ...
    async def failed(self, item_id: int, error: str) -> None: ...


@dataclass(frozen=True)
class IndexSummary:
    points: int
    removed_stale: bool
    waiting: bool  # no vectors yet (the embedding model server wasn't running)


UPSERT_BATCH = 128


class IndexSource:
    def __init__(
        self, sources: Sources, store: IndexStore, files: VectorFiles, embedder: Embedder, index: SearchIndex
    ) -> None:
        self._sources = sources
        self._store = store
        self._files = files
        self._embedder = embedder
        self._index = index

    async def execute(self, org_id: UUID, source_id: UUID, *, run_id: str) -> IndexSummary:
        facts = await self._store.source_facts(org_id, source_id)
        if facts is None:
            raise SourceNotFound(f"source {source_id} not found in organization {org_id}")
        version = self._embedder.version
        vectors = {v.content_hash: v.vector for v in await self._files.read(org_id, source_id, version)}
        chunks = await self._store.chunks(org_id, source_id)
        ready = [chunk for chunk in chunks if chunk.content_hash in vectors]
        if chunks and not ready:
            await self._sources.record_stage(
                org_id,
                source_id,
                stage="indexed",
                status="pending",
                run_id=run_id,
                error="waiting for vectors (the embedding model server isn't running)",
                advance=False,
            )
            return IndexSummary(0, False, waiting=True)
        await self._sources.record_stage(org_id, source_id, stage="indexed", status="running", run_id=run_id)
        ancestors = await self._store.ancestors(org_id)
        points = [
            Point(chunk.id, vectors[chunk.content_hash], chunk_payload(facts, chunk, ancestors, version.id))
            for chunk in ready
        ]
        for start in range(0, len(points), UPSERT_BATCH):
            await self._index.upsert("chunks", points[start : start + UPSERT_BATCH])
        await self._index.delete_source(org_id, source_id, keep=[point.id for point in points])
        await self._store.mark_indexed(org_id, [point.id for point in points])
        await self._sources.record_stage(
            org_id,
            source_id,
            stage="indexed",
            status="done" if points else "pending",
            run_id=run_id,
            detail={"points": len(points), "waitingForVectors": len(chunks) - len(ready)},
        )
        return IndexSummary(len(points), True, waiting=False)


class ApplyOutbox:
    """Applies queued index changes in order. Applying one twice has the same effect as once."""

    def __init__(self, outbox: Outbox, index: SearchIndex) -> None:
        self._outbox = outbox
        self._index = index

    async def execute(self, limit: int = 200) -> int:
        items = await self._outbox.next(limit)
        for item in items:
            try:
                await self._apply(item)
            except Exception as error:  # recorded on the row; the next pass tries it again
                await self._outbox.failed(item.id, f"{type(error).__name__}: {error}")
                continue
            await self._outbox.done(item.id)
        return len(items)

    async def _apply(self, item: OutboxItem) -> None:
        collection = "questions" if item.entity == "question" else "chunks"
        if item.entity == "source":
            if item.op == "delete":
                await self._index.delete_source(item.org_id, item.entity_id)
            return  # a source's payload changes by re-indexing it
        if item.op == "delete":
            await self._index.delete(collection, [item.entity_id])
        else:
            await self._index.set_payload(collection, [item.entity_id], item.payload)
