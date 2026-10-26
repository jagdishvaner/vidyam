"""Postgres adapter for ingestion: every statement runs inside the source's organization (row-level security).
Re-running a stage replaces what it wrote before, so a retried activity never duplicates pages or chunks."""

from collections.abc import Sequence
from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncEngine

from vidyam_ai.application.ingestion import SourceFile, Stage, Status
from vidyam_ai.domain.chunking import Chunk, PageText, detect_language
from vidyam_ai.domain.documents import PageReading
from vidyam_ai.infrastructure.db.engine import org_transaction
from vidyam_ai.infrastructure.db.generated.tables import t_chunks, t_pages, t_pipeline_runs, t_sources


class SqlSources:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def get(self, org_id: UUID, source_id: UUID) -> SourceFile | None:
        query = select(t_sources.c.s3_key, t_sources.c.mime_type).where(t_sources.c.id == source_id)
        async with org_transaction(self._engine, org_id) as conn:
            row = (await conn.execute(query)).first()
        return SourceFile(source_id, org_id, row.s3_key, row.mime_type) if row else None

    async def save_pages(self, source: SourceFile, pages: Sequence[PageReading]) -> None:
        rows = [_page_row(source, page) for page in pages]
        readable = "\n".join(page.text for page in pages if not page.needs_ocr)
        async with org_transaction(self._engine, source.org_id) as conn:
            await conn.execute(delete(t_pages).where(t_pages.c.source_id == source.id))
            if rows:
                await conn.execute(insert(t_pages), rows)
            await conn.execute(
                update(t_sources)
                .where(t_sources.c.id == source.id)
                .values(
                    page_count=sum(page.page_no is not None for page in pages) or None,
                    language=detect_language(readable) if readable.strip() else None,
                    updated_at=func.now(),
                )
            )

    async def usable_pages(self, org_id: UUID, source_id: UUID) -> list[PageText]:
        query = (
            select(t_pages.c.page_no, t_pages.c.content_md, t_pages.c.meta)
            .where(t_pages.c.source_id == source_id, t_pages.c.meta["awaitingOcr"].is_(None))
            .order_by(t_pages.c.page_no)
        )
        async with org_transaction(self._engine, org_id) as conn:
            rows = (await conn.execute(query)).all()
        return [PageText(None if row.meta.get("virtual") else row.page_no, row.content_md) for row in rows]

    async def save_chunks(self, org_id: UUID, source_id: UUID, chunks: Sequence[Chunk]) -> None:
        rows = [
            {
                "org_id": org_id,
                "source_id": source_id,
                "position": position,
                "page_start": chunk.page_start,
                "page_end": chunk.page_end,
                "text": chunk.text,
                "language": chunk.language,
                "token_count": chunk.token_count,
            }
            for position, chunk in enumerate(chunks)
        ]
        async with org_transaction(self._engine, org_id) as conn:
            await conn.execute(delete(t_chunks).where(t_chunks.c.source_id == source_id))
            if rows:
                await conn.execute(insert(t_chunks), rows)

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
    ) -> None:
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


def _page_row(source: SourceFile, page: PageReading) -> dict[str, Any]:
    meta: dict[str, Any] = {}
    if page.page_no is None:
        meta["virtual"] = True  # Word and text files are stored as one page without a real page number
    if page.note:
        meta["note"] = page.note
    if page.needs_ocr:
        meta["awaitingOcr"] = True
    return {
        "org_id": source.org_id,
        "source_id": source.id,
        "page_no": page.page_no or 1,
        "method": page.method or "vision_ocr",  # what will produce its text
        "content_md": "" if page.needs_ocr else page.text,
        "confidence": page.confidence,
        "meta": meta,
    }
