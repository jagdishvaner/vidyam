"""Postgres adapter for ingestion: every statement runs inside the source's organization (row-level security).
Re-running a stage replaces what it wrote before, so a retried activity never duplicates pages or chunks; and
what is expensive to make again survives it: pages read by OCR or corrected by hand, and the tags of chunks
whose text did not change."""

from collections.abc import Mapping, Sequence
from typing import Any, cast
from uuid import UUID

from sqlalchemy import and_, delete, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from vidyam_ai.application.ingestion import (
    ChunkPlace,
    PlacedChunk,
    SourceFile,
    Stage,
    Status,
    StoredPage,
)
from vidyam_ai.domain.chunking import CHUNKER_VERSION, HEADING_SEPARATOR, detect_language
from vidyam_ai.domain.documents import PageReading
from vidyam_ai.domain.headings import page_markdown
from vidyam_ai.domain.sections import ManifestSection, PlannedSection, Structure
from vidyam_ai.domain.tagging import RULES_TAGGER, Tag
from vidyam_ai.infrastructure.db.engine import org_transaction
from vidyam_ai.infrastructure.db.generated.tables import (
    t_chunk_tags,
    t_chunks,
    t_pages,
    t_pipeline_runs,
    t_source_sections,
    t_sources,
)

_KEPT_METHODS = ("vision_ocr", "manual")  # text that cost a model call or a person's time
_RULE_METHODS = ("manifest", "section")


def _uuid(value: object) -> UUID | None:
    return UUID(str(value)) if value else None


def _object(value: object) -> dict[str, Any]:
    return cast(dict[str, Any], value) if isinstance(value, dict) else {}


def structure_from_meta(meta: Mapping[str, Any]) -> Structure:
    """`sources.meta.structure`, written by the API's manifest import with syllabus ids resolved."""
    raw = _object(meta.get("structure"))
    sections = raw.get("sections")
    return Structure(
        chapter=_uuid(_object(raw.get("chapter")).get("nodeId")),
        sections=tuple(
            ManifestSection(
                int(s["pageStart"]), int(s["pageEnd"]), UUID(str(s["nodeId"])), s.get("title") or None
            )
            for s in map(_object, cast(list[object], sections) if isinstance(sections, list) else [])
            if s.get("nodeId")
        ),
    )


class SqlSources:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def get(self, org_id: UUID, source_id: UUID) -> SourceFile | None:
        query = select(t_sources).where(t_sources.c.id == source_id)
        async with org_transaction(self._engine, org_id) as conn:
            row = (await conn.execute(query)).first()
        if row is None:
            return None
        return SourceFile(
            source_id,
            org_id,
            row.s3_key,
            row.mime_type,
            kind=row.kind,
            title=row.title,
            language=row.language,
            subject_node_id=row.subject_node_id,
            page_offset=row.page_offset,
            structure=structure_from_meta(row.meta),
        )

    async def save_pages(
        self, source: SourceFile, pages: Sequence[PageReading], images: Mapping[int, str]
    ) -> None:
        readable = "\n".join(page.text for page in pages if not page.needs_ocr)
        async with org_transaction(self._engine, source.org_id) as conn:
            existing = (
                await conn.execute(
                    select(t_pages.c.page_no, t_pages.c.method, t_pages.c.meta).where(
                        t_pages.c.source_id == source.id
                    )
                )
            ).all()
            kept = {
                row.page_no
                for row in existing
                if row.method in _KEPT_METHODS and not row.meta.get("awaitingOcr")
            }
            await conn.execute(
                delete(t_pages).where(t_pages.c.source_id == source.id, t_pages.c.page_no.not_in(kept))
            )
            rows = [_page_row(source, page, images) for page in pages]
            fresh = [row for row in rows if row["page_no"] not in kept]
            if fresh:
                await conn.execute(insert(t_pages), fresh)
            for row in rows:
                if row["page_no"] in kept:  # the text stays; the label and image follow the new reading
                    await conn.execute(
                        update(t_pages)
                        .where(t_pages.c.source_id == source.id, t_pages.c.page_no == row["page_no"])
                        .values(page_label=row["page_label"], image_s_3_key=row["image_s_3_key"])
                    )
            await conn.execute(
                update(t_sources)
                .where(t_sources.c.id == source.id)
                .values(
                    page_count=sum(page.page_no is not None for page in pages) or None,
                    # The manifest's language wins; otherwise it is detected from what was read.
                    language=func.coalesce(
                        t_sources.c.language, detect_language(readable) if readable.strip() else None
                    ),
                    updated_at=func.now(),
                )
            )

    async def pages(self, org_id: UUID, source_id: UUID) -> list[StoredPage]:
        query = (
            select(
                t_pages.c.page_no,
                t_pages.c.page_label,
                t_pages.c.content_md,
                t_pages.c.method,
                t_pages.c.meta,
            )
            .where(t_pages.c.source_id == source_id)
            .order_by(t_pages.c.page_no)
        )
        async with org_transaction(self._engine, org_id) as conn:
            rows = (await conn.execute(query)).all()
        return [
            StoredPage(
                None if row.meta.get("virtual") else row.page_no,
                row.page_label,
                row.content_md,
                row.method,
                bool(row.meta.get("awaitingOcr")),
            )
            for row in rows
        ]

    async def save_structure(
        self, source: SourceFile, sections: Sequence[PlannedSection], chunks: Sequence[PlacedChunk]
    ) -> None:
        async with org_transaction(self._engine, source.org_id) as conn:
            await conn.execute(delete(t_source_sections).where(t_source_sections.c.source_id == source.id))
            section_ids: list[UUID] = []
            if sections:
                inserted = await conn.execute(
                    insert(t_source_sections).returning(t_source_sections.c.id, sort_by_parameter_order=True),
                    [
                        {
                            "org_id": source.org_id,
                            "source_id": source.id,
                            "title": section.title,
                            "page_start": section.page_start,
                            "page_end": section.page_end,
                            "node_id": section.node_id,
                            "origin": section.origin,
                            "confidence": section.confidence,
                            "position": position,
                        }
                        for position, section in enumerate(sections)
                    ],
                )
                section_ids = [row.id for row in inserted]
            await _save_chunks(conn, source, chunks, section_ids)

    async def chunk_places(self, org_id: UUID, source_id: UUID) -> list[ChunkPlace]:
        query = (
            select(
                t_chunks.c.id,
                t_source_sections.c.title,
                t_source_sections.c.page_start,
                t_source_sections.c.page_end,
                t_source_sections.c.node_id,
                t_source_sections.c.origin,
                t_source_sections.c.confidence,
            )
            .select_from(
                t_chunks.outerjoin(t_source_sections, t_source_sections.c.id == t_chunks.c.section_id)
            )
            .where(t_chunks.c.source_id == source_id)
            .order_by(t_chunks.c.position)
        )
        async with org_transaction(self._engine, org_id) as conn:
            rows = (await conn.execute(query)).all()
        return [
            ChunkPlace(
                row.id,
                PlannedSection(
                    row.title, row.page_start, row.page_end, row.node_id, row.origin, row.confidence
                )
                if row.origin
                else None,
            )
            for row in rows
        ]

    async def save_rule_tags(self, org_id: UUID, source_id: UUID, tags: Mapping[UUID, Sequence[Tag]]) -> None:
        """Replaces the rule tags of the source's chunks. A chunk whose rule chapter changed also loses its
        model-picked topics, which were chosen among the old chapter's children."""
        chunk_ids = list(tags)
        async with org_transaction(self._engine, org_id) as conn:
            before = {
                row.chunk_id: row.node_id
                for row in await conn.execute(
                    select(t_chunk_tags.c.chunk_id, t_chunk_tags.c.node_id).where(
                        t_chunk_tags.c.chunk_id.in_(chunk_ids),
                        t_chunk_tags.c.method.in_(_RULE_METHODS),
                        t_chunk_tags.c.is_primary,
                    )
                )
            }
            moved = [
                chunk_id
                for chunk_id, chunk_tags in tags.items()
                if chunk_id in before
                and before[chunk_id] != next((t.node_id for t in chunk_tags if t.is_primary), None)
            ]
            await conn.execute(
                delete(t_chunk_tags).where(
                    t_chunk_tags.c.chunk_id.in_(chunk_ids),
                    t_chunk_tags.c.method.in_(_RULE_METHODS)
                    | and_(t_chunk_tags.c.chunk_id.in_(moved), t_chunk_tags.c.method == "llm"),
                )
            )
            if moved:  # their topics are picked again, among the new chapter's
                await conn.execute(
                    update(t_chunks).where(t_chunks.c.id.in_(moved)).values(topics_checked_at=None)
                )
            # A model-picked topic stays the chunk's main tag; the rule's chapter is kept beside it.
            topical = {
                row.chunk_id
                for row in await conn.execute(
                    select(t_chunk_tags.c.chunk_id).where(
                        t_chunk_tags.c.chunk_id.in_(chunk_ids),
                        t_chunk_tags.c.method == "llm",
                        t_chunk_tags.c.is_primary,
                    )
                )
            }
            rows = [
                {
                    "org_id": org_id,
                    "chunk_id": chunk_id,
                    "node_id": tag.node_id,
                    "confidence": tag.confidence,
                    "method": tag.method,
                    "tagger_version": RULES_TAGGER,
                    "is_primary": tag.is_primary and chunk_id not in topical,
                }
                for chunk_id, chunk_tags in tags.items()
                for tag in chunk_tags
            ]
            if rows:
                # A person's or a model's tag on the same node stays; the rule doesn't overwrite it.
                await conn.execute(pg_insert(t_chunk_tags).on_conflict_do_nothing(), rows)

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
    ) -> None:
        """`advance`: also show the stage on the source. Backlog work (OCR, questions, topics) is recorded
        in pipeline_runs only, so a finished file never looks unfinished while a backlog runs."""
        finished = status in ("done", "pending", "failed")
        run: dict[str, Any] = {"status": status, "job_id": run_id, "error": error, "meta": detail or {}}
        if finished:
            run["finished_at"] = func.now()
        else:
            run |= {"started_at": func.now(), "finished_at": None}
        upsert = pg_insert(t_pipeline_runs).values(org_id=org_id, source_id=source_id, stage=stage, **run)
        upsert = upsert.on_conflict_do_update(
            index_elements=[t_pipeline_runs.c.source_id, t_pipeline_runs.c.stage],
            set_={**run, "attempt": t_pipeline_runs.c.attempt + (0 if finished else 1)},
        )
        async with org_transaction(self._engine, org_id) as conn:
            await conn.execute(upsert)
            if advance:
                await conn.execute(
                    update(t_sources)
                    .where(t_sources.c.id == source_id)
                    .values(stage=stage, status=status, error=error, updated_at=func.now())
                )

    async def mark_failed(self, org_id: UUID, source_id: UUID, *, run_id: str, error: str) -> None:
        async with org_transaction(self._engine, org_id) as conn:
            await conn.execute(
                update(t_pipeline_runs)
                .where(t_pipeline_runs.c.source_id == source_id, t_pipeline_runs.c.status == "running")
                .values(status="failed", error=error, finished_at=func.now())
            )
            await conn.execute(
                update(t_sources)
                .where(t_sources.c.id == source_id)
                .values(status="failed", error=error, updated_at=func.now())
            )


async def _save_chunks(
    conn: AsyncConnection, source: SourceFile, chunks: Sequence[PlacedChunk], section_ids: Sequence[UUID]
) -> None:
    """A chunk whose embedded content (header and text) is unchanged at its position keeps its row, so its
    tags and vectors stay; the rest are replaced."""
    existing = {
        row.position: (row.id, row.content_hash)
        for row in await conn.execute(
            select(t_chunks.c.id, t_chunks.c.position, t_chunks.c.content_hash).where(
                t_chunks.c.source_id == source.id
            )
        )
    }
    unchanged = {
        position
        for position, placed in enumerate(chunks)
        if position in existing and existing[position][1] == placed.content_hash
    }
    await conn.execute(
        delete(t_chunks).where(t_chunks.c.source_id == source.id, t_chunks.c.position.not_in(unchanged))
    )
    rows: list[dict[str, Any]] = []
    for position, placed in enumerate(chunks):
        chunk = placed.chunk
        values: dict[str, Any] = {
            "section_id": section_ids[placed.section] if placed.section is not None else None,
            "heading_path": HEADING_SEPARATOR.join(chunk.heading_path) or None,
            "kind": chunk.kind,
            "chunker_version": CHUNKER_VERSION,
            "page_start": chunk.page_start,
            "page_end": chunk.page_end,
        }
        if position in unchanged:
            await conn.execute(update(t_chunks).where(t_chunks.c.id == existing[position][0]).values(values))
            continue
        rows.append(
            {
                **values,
                "org_id": source.org_id,
                "source_id": source.id,
                "position": position,
                "text": chunk.text,
                "context_header": placed.context_header,
                "content_hash": placed.content_hash,
                "language": chunk.language,
                "token_count": chunk.token_count,
            }
        )
    if rows:
        await conn.execute(insert(t_chunks), rows)


def _page_row(source: SourceFile, page: PageReading, images: Mapping[int, str]) -> dict[str, Any]:
    meta: dict[str, Any] = {}
    if page.page_no is None:
        meta["virtual"] = True  # Word and text files are stored as one page without a real page number
    if page.note:
        meta["note"] = page.note
    if page.needs_ocr:
        meta["awaitingOcr"] = True
    label = page.label
    if label is None and page.page_no is not None and source.page_offset is not None:
        label = str(page.page_no + source.page_offset)
    return {
        "org_id": source.org_id,
        "source_id": source.id,
        "page_no": page.page_no or 1,
        "method": page.method or "vision_ocr",  # what will produce its text
        "content_md": "" if page.needs_ocr else page_markdown(page.text, page.headings),
        "confidence": page.confidence,
        "page_label": label,
        "image_s_3_key": images.get(page.page_no or 1),  # Drizzle's spelling of imageS3Key
        "extractor_version": page.extractor,
        "meta": meta,
    }
