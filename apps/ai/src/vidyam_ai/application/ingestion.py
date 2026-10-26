"""Ingesting one uploaded file (ADR 0014): read every page into clean Unicode, then split the usable text into
chunks. Pages that need OCR are recorded and wait for the OCR step."""

from collections.abc import Awaitable, Callable, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol
from uuid import UUID

from vidyam_ai.domain.chunking import Chunk, PageText, chunk_pages
from vidyam_ai.domain.documents import PageReading

Stage = Literal["parsed", "chunked"]
Status = Literal["running", "done", "pending", "failed"]


@dataclass(frozen=True)
class SourceFile:
    id: UUID
    org_id: UUID
    s3_key: str
    mime_type: str


class SourceNotFound(Exception):
    pass


class UnreadableFile(Exception):
    """The file can't be read at all (damaged, encrypted, an unsupported type): retrying won't help."""


class Sources(Protocol):
    """Port: the source's rows in Postgres (sources, pages, chunks, pipeline_runs), scoped to its org."""

    async def get(self, org_id: UUID, source_id: UUID) -> SourceFile | None: ...
    async def save_pages(self, source: SourceFile, pages: Sequence[PageReading]) -> None: ...
    async def usable_pages(self, org_id: UUID, source_id: UUID) -> list[PageText]: ...
    async def save_chunks(self, org_id: UUID, source_id: UUID, chunks: Sequence[Chunk]) -> None: ...
    async def record_stage(
        self,
        org_id: UUID,
        source_id: UUID,
        *,
        stage: Stage,
        status: Status,
        run_id: str,
        detail: dict[str, int] | None = None,
        error: str | None = None,
    ) -> None: ...
    async def mark_failed(self, org_id: UUID, source_id: UUID, *, run_id: str, error: str) -> None: ...


class Files(Protocol):
    """Port: the uploaded originals (S3)."""

    def local_copy(self, key: str) -> AbstractAsyncContextManager[Path]: ...


# Reads a local file of the given MIME type. CPU-heavy, so the adapter runs it in another process.
Reader = Callable[[str, str], Awaitable[list[PageReading]]]


@dataclass(frozen=True)
class ExtractionSummary:
    pages: int
    text_pages: int
    legacy_font_pages: int
    ocr_pages: int


class ExtractSource:
    def __init__(self, sources: Sources, files: Files, read: Reader) -> None:
        self._sources = sources
        self._files = files
        self._read = read

    async def execute(self, org_id: UUID, source_id: UUID, *, run_id: str) -> ExtractionSummary:
        source = await self._sources.get(org_id, source_id)
        if source is None:
            raise SourceNotFound(f"source {source_id} not found in organization {org_id}")
        await self._sources.record_stage(org_id, source_id, stage="parsed", status="running", run_id=run_id)
        async with self._files.local_copy(source.s3_key) as path:
            pages = await self._read(str(path), source.mime_type)
        await self._sources.save_pages(source, pages)
        summary = ExtractionSummary(
            pages=len(pages),
            text_pages=sum(p.method == "text_layer" for p in pages),
            legacy_font_pages=sum(p.method == "legacy_font" for p in pages),
            ocr_pages=sum(p.needs_ocr for p in pages),
        )
        await self._sources.record_stage(
            org_id, source_id, stage="parsed", status="done", run_id=run_id, detail=vars(summary)
        )
        return summary


class ChunkSource:
    def __init__(self, sources: Sources) -> None:
        self._sources = sources

    async def execute(self, org_id: UUID, source_id: UUID, *, run_id: str) -> int:
        await self._sources.record_stage(org_id, source_id, stage="chunked", status="running", run_id=run_id)
        chunks = chunk_pages(await self._sources.usable_pages(org_id, source_id))
        await self._sources.save_chunks(org_id, source_id, chunks)
        # No chunks means nothing readable yet (a scan waiting for OCR, or an empty file).
        await self._sources.record_stage(
            org_id,
            source_id,
            stage="chunked",
            status="done" if chunks else "pending",
            run_id=run_id,
            detail={"chunks": len(chunks)},
        )
        return len(chunks)
