"""Ingesting one uploaded file (ADR 0014, plan v3 §5): read every page into clean Unicode with its headings
and a page image; find the file's sections and chunk the usable text under its headings; then tag the chunks
with the syllabus by rules. Pages that need OCR are recorded and wait for the OCR backlog.

Every stage replaces what it wrote before, so it can be re-run from the layer below it: a changed manifest
re-runs sections, chunks and tags from the stored pages, without reading the file again.
"""

import hashlib
import tempfile
from collections.abc import Awaitable, Callable, Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Protocol
from uuid import UUID

from vidyam_ai.domain.chunking import Chunk, PageText, chunk_pages, context_header
from vidyam_ai.domain.documents import PageReading
from vidyam_ai.domain.sections import (
    LabelledPage,
    PlannedSection,
    Structure,
    SyllabusNode,
    plan_sections,
    section_of,
)
from vidyam_ai.domain.tagging import Tag, rule_tags

Stage = Literal["parsed", "chunked", "tagged", "segmented"]
Status = Literal["running", "done", "pending", "failed"]


@dataclass(frozen=True)
class SourceFile:
    id: UUID
    org_id: UUID
    s3_key: str
    mime_type: str
    kind: str = "other"
    title: str | None = None
    language: str | None = None  # hi, en or mixed, when the manifest or a first reading said so
    subject_node_id: UUID | None = None
    page_offset: int | None = None
    structure: Structure = field(default_factory=Structure)


@dataclass(frozen=True)
class StoredPage:
    page_no: int | None  # None for Word and text files, stored as one page without a real number
    label: str | None
    text: str  # Markdown
    method: str
    awaiting_ocr: bool


@dataclass(frozen=True)
class PlacedChunk:
    """A chunk ready to store: where it sits in its file, and what is embedded with it."""

    chunk: Chunk
    section: int | None  # index into the source's sections
    context_header: str | None
    content_hash: str  # of what is embedded (header + text): unchanged chunks keep their tags and vectors


@dataclass(frozen=True)
class ChunkPlace:
    chunk_id: UUID
    section: PlannedSection | None


class SourceNotFound(Exception):
    pass


class UnreadableFile(Exception):
    """The file can't be read at all (damaged, encrypted, an unsupported type): retrying won't help."""


class Sources(Protocol):
    """Port: a source's rows in Postgres (sources, pages, sections, chunks, tags, pipeline_runs), scoped to
    its organization."""

    async def get(self, org_id: UUID, source_id: UUID) -> SourceFile | None: ...
    async def save_pages(
        self, source: SourceFile, pages: Sequence[PageReading], images: Mapping[int, str]
    ) -> None: ...
    async def pages(self, org_id: UUID, source_id: UUID) -> list[StoredPage]: ...
    async def save_structure(
        self, source: SourceFile, sections: Sequence[PlannedSection], chunks: Sequence[PlacedChunk]
    ) -> None: ...
    async def chunk_places(self, org_id: UUID, source_id: UUID) -> list[ChunkPlace]: ...
    async def save_rule_tags(
        self, org_id: UUID, source_id: UUID, tags: Mapping[UUID, Sequence[Tag]]
    ) -> None: ...
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
        advance: bool = True,
    ) -> None: ...
    async def mark_failed(self, org_id: UUID, source_id: UUID, *, run_id: str, error: str) -> None: ...


class Syllabus(Protocol):
    """Port: the organization's syllabus tree."""

    async def subtree(self, org_id: UUID, root_id: UUID | None) -> list[SyllabusNode]:
        """Active nodes under `root_id` (itself included), or the whole syllabus when it is None."""
        ...


class Files(Protocol):
    """Port: the uploaded originals (S3)."""

    def local_copy(self, key: str) -> AbstractAsyncContextManager[Path]: ...


class PageImages(Protocol):
    """Port: where page images are kept (S3). Returns the stored key of each page's image."""

    async def upload(self, source: SourceFile, files: Mapping[int, str]) -> dict[int, str]: ...


# Reads a local file of the given MIME type; renders its pages as images into a folder. CPU-heavy, so the
# adapters run them in other processes.
Reader = Callable[[str, str], Awaitable[list[PageReading]]]
Renderer = Callable[[str, str, str], Awaitable[dict[int, str]]]


@dataclass(frozen=True)
class ExtractionSummary:
    pages: int
    text_pages: int
    legacy_font_pages: int
    ocr_pages: int


@dataclass(frozen=True)
class StructureSummary(ExtractionSummary):
    sections: int
    chunks: int


class ExtractSource:
    def __init__(
        self, sources: Sources, files: Files, read: Reader, render: Renderer, images: PageImages
    ) -> None:
        self._sources = sources
        self._files = files
        self._read = read
        self._render = render
        self._images = images

    async def execute(self, org_id: UUID, source_id: UUID, *, run_id: str) -> ExtractionSummary:
        source = await self._sources.get(org_id, source_id)
        if source is None:
            raise SourceNotFound(f"source {source_id} not found in organization {org_id}")
        await self._sources.record_stage(org_id, source_id, stage="parsed", status="running", run_id=run_id)
        async with self._files.local_copy(source.s3_key) as path:
            pages = await self._read(str(path), source.mime_type)
            with tempfile.TemporaryDirectory(prefix="vidyam-pages-") as folder:
                rendered = await self._render(str(path), source.mime_type, folder)
                images = await self._images.upload(source, rendered)
        await self._sources.save_pages(source, pages, images)
        summary = ExtractionSummary(
            pages=len(pages),
            text_pages=sum(p.method == "text_layer" and not p.needs_ocr for p in pages),
            legacy_font_pages=sum(p.method == "legacy_font" and not p.needs_ocr for p in pages),
            ocr_pages=sum(p.needs_ocr for p in pages),
        )
        await self._sources.record_stage(
            org_id, source_id, stage="parsed", status="done", run_id=run_id, detail=vars(summary)
        )
        return summary


def _content_hash(header: str | None, text: str) -> str:
    return hashlib.sha256(f"{header or ''}\n{text}".encode()).hexdigest()


class StructureSource:
    """Sections from the manifest, the table of contents or headings; then chunks, each in its section."""

    def __init__(self, sources: Sources, syllabus: Syllabus) -> None:
        self._sources = sources
        self._syllabus = syllabus

    async def execute(self, org_id: UUID, source_id: UUID, *, run_id: str) -> StructureSummary:
        source = await self._sources.get(org_id, source_id)
        if source is None:
            raise SourceNotFound(f"source {source_id} not found in organization {org_id}")
        await self._sources.record_stage(org_id, source_id, stage="chunked", status="running", run_id=run_id)
        stored = await self._sources.pages(org_id, source_id)
        usable = [page for page in stored if not page.awaiting_ocr]
        nodes = await self._syllabus.subtree(org_id, source.subject_node_id)
        sections = plan_sections(
            [LabelledPage(page.page_no, page.label, page.text) for page in usable],
            source.structure,
            nodes,
            hindi=source.language == "hi",
        )
        placed: list[PlacedChunk] = []
        for chunk in chunk_pages([PageText(page.page_no, page.text) for page in usable]):
            header = context_header(source.title, chunk.heading_path)
            placed.append(
                PlacedChunk(chunk, section_of(chunk, sections), header, _content_hash(header, chunk.text))
            )
        await self._sources.save_structure(source, sections, placed)
        summary = StructureSummary(
            pages=len(stored),
            text_pages=sum(p.method == "text_layer" and not p.awaiting_ocr for p in stored),
            legacy_font_pages=sum(p.method == "legacy_font" and not p.awaiting_ocr for p in stored),
            ocr_pages=sum(p.awaiting_ocr for p in stored),
            sections=len(sections),
            chunks=len(placed),
        )
        # No chunks means nothing readable yet (a scan waiting for OCR, or an empty file).
        await self._sources.record_stage(
            org_id,
            source_id,
            stage="chunked",
            status="done" if placed else "pending",
            run_id=run_id,
            detail={"sections": summary.sections, "chunks": summary.chunks},
        )
        return summary


class TagSource:
    """Syllabus tags by rules: the manifest's chapter, else the chunk's section, else the subject."""

    def __init__(self, sources: Sources) -> None:
        self._sources = sources

    async def execute(self, org_id: UUID, source_id: UUID, *, run_id: str) -> int:
        source = await self._sources.get(org_id, source_id)
        if source is None:
            raise SourceNotFound(f"source {source_id} not found in organization {org_id}")
        await self._sources.record_stage(org_id, source_id, stage="tagged", status="running", run_id=run_id)
        places = await self._sources.chunk_places(org_id, source_id)
        tags = {
            place.chunk_id: rule_tags(source.structure.chapter, place.section, source.subject_node_id)
            for place in places
        }
        await self._sources.save_rule_tags(org_id, source_id, tags)
        tagged = sum(bool(chunk_tags) for chunk_tags in tags.values())
        await self._sources.record_stage(
            org_id,
            source_id,
            stage="tagged",
            status="done" if places else "pending",
            run_id=run_id,
            detail={"chunks": len(places), "tagged": tagged},
        )
        return tagged
