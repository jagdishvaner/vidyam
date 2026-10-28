"""Embedding a file's chunks (plan v3 §5, step 9) with the self-hosted Qwen3 model server (§8).

Vectors are kept twice: a Parquet copy per file in S3, and later in Qdrant (step 19). The Parquet copy is
what makes re-indexing free: a new Qdrant layout or a rebuilt collection is filled from it without asking the
model again, and a chunk whose embedded text is unchanged (same content hash) reuses its vector even after the
file was re-chunked.

Without a running model server (no `pnpm models:up`), a file is left waiting at this stage instead of failing;
it is embedded once the server is back.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from vidyam_ai.application.ingestion import SourceNotFound, Sources
from vidyam_ai.domain.embeddings import EmbeddingVersion, document_text

BATCH = 16  # texts per request: keeps each request well inside the server's per-request token limit


class ModelServerError(Exception):
    def __init__(self, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.retryable = retryable


class Embedder(Protocol):
    """Port: the embedding model server (OpenAI-style /v1/embeddings)."""

    @property
    def version(self) -> EmbeddingVersion: ...
    async def ready(self) -> bool: ...
    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        """One L2-normalized vector per text, in order. Texts are embedded exactly as they are passed."""
        ...


class Reranker(Protocol):
    """Port: the rerank model server (Cohere/Jina-style /v1/rerank)."""

    async def ready(self) -> bool: ...
    async def rerank(self, query: str, documents: Sequence[str]) -> list[float]:
        """How relevant each document is to the query, from 0 to 1, in the documents' order."""
        ...


@dataclass(frozen=True)
class ChunkToEmbed:
    id: UUID
    text: str
    context_header: str | None
    content_hash: str


@dataclass(frozen=True)
class StoredVector:
    chunk_id: UUID
    content_hash: str
    vector: list[float]


class EmbeddingStore(Protocol):
    """Port: chunks to embed, and where vectors are kept."""

    async def chunks(self, org_id: UUID, source_id: UUID) -> list[ChunkToEmbed]: ...
    async def mark_embedded(
        self, org_id: UUID, chunk_ids: Sequence[UUID], version: EmbeddingVersion
    ) -> None: ...


class VectorFiles(Protocol):
    """Port: the Parquet copy of each file's vectors, per embedding version (S3)."""

    async def read(self, org_id: UUID, source_id: UUID, version: EmbeddingVersion) -> list[StoredVector]: ...
    async def write(
        self, org_id: UUID, source_id: UUID, version: EmbeddingVersion, vectors: Sequence[StoredVector]
    ) -> None: ...


@dataclass(frozen=True)
class EmbeddingSummary:
    chunks: int
    embedded: int  # sent to the model this time
    reused: int  # unchanged since an earlier run
    waiting: bool  # the model server wasn't running; nothing was done


class EmbedSource:
    def __init__(
        self, sources: Sources, store: EmbeddingStore, files: VectorFiles, embedder: Embedder
    ) -> None:
        self._sources = sources
        self._store = store
        self._files = files
        self._embedder = embedder

    async def execute(self, org_id: UUID, source_id: UUID, *, run_id: str) -> EmbeddingSummary:
        if await self._sources.get(org_id, source_id) is None:
            raise SourceNotFound(f"source {source_id} not found in organization {org_id}")
        if not await self._embedder.ready():
            await self._sources.record_stage(
                org_id,
                source_id,
                stage="embedded",
                status="pending",
                run_id=run_id,
                error="the embedding model server isn't running (pnpm models:up)",
                advance=False,
            )
            return EmbeddingSummary(0, 0, 0, waiting=True)
        await self._sources.record_stage(org_id, source_id, stage="embedded", status="running", run_id=run_id)
        version = self._embedder.version
        chunks = await self._store.chunks(org_id, source_id)
        known = {
            stored.content_hash: stored.vector
            for stored in await self._files.read(org_id, source_id, version)
        }
        missing = [chunk for chunk in chunks if chunk.content_hash not in known]
        for start in range(0, len(missing), BATCH):
            batch = missing[start : start + BATCH]
            vectors = await self._embedder.embed([document_text(c.context_header, c.text) for c in batch])
            known.update((chunk.content_hash, vector) for chunk, vector in zip(batch, vectors, strict=True))
        await self._files.write(
            org_id,
            source_id,
            version,
            [StoredVector(chunk.id, chunk.content_hash, known[chunk.content_hash]) for chunk in chunks],
        )
        await self._store.mark_embedded(org_id, [chunk.id for chunk in chunks], version)
        summary = EmbeddingSummary(len(chunks), len(missing), len(chunks) - len(missing), waiting=False)
        await self._sources.record_stage(
            org_id,
            source_id,
            stage="embedded",
            status="done" if chunks else "pending",
            run_id=run_id,
            detail={"chunks": summary.chunks, "embedded": summary.embedded, "reused": summary.reused},
        )
        return summary
