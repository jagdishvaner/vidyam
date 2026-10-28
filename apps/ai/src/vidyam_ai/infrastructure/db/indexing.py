"""Postgres adapter for indexing: a file's facts and chunks with their tags, syllabus ancestry, and the
outbox of index changes (`index_outbox`, which has no row-level security: only the AI engine reads it)."""

from collections.abc import Sequence
from typing import Literal, cast
from uuid import UUID

from sqlalchemy import and_, exists, func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncEngine

from vidyam_ai.application.indexing import OutboxItem
from vidyam_ai.domain.indexing import ChunkFacts, IndexTag, SourceFacts
from vidyam_ai.infrastructure.db.engine import org_transaction
from vidyam_ai.infrastructure.db.generated.tables import (
    t_chunk_tags,
    t_chunks,
    t_index_outbox,
    t_organizations,
    t_pages,
    t_sources,
)
from vidyam_ai.infrastructure.db.syllabus import SqlSyllabus

MAX_ATTEMPTS = 10  # then the row stays for a person to look at (System health shows the outbox)
SETTLED = "2 minutes"  # a file changed more recently than this may still be in its ingestion workflow
_READ_STAGES = ("chunked", "tagged", "embedded", "indexed")


class SqlIndexStore:
    def __init__(self, engine: AsyncEngine, syllabus: SqlSyllabus) -> None:
        self._engine = engine
        self._syllabus = syllabus

    async def source_facts(self, org_id: UUID, source_id: UUID) -> SourceFacts | None:
        async with org_transaction(self._engine, org_id) as conn:
            row = (await conn.execute(select(t_sources).where(t_sources.c.id == source_id))).first()
        if row is None:
            return None
        return SourceFacts(
            row.id,
            row.org_id,
            row.kind,
            row.licence,
            row.language,
            row.parallel_group_id,
            row.subject_node_id,
            tuple(row.exam_codes),
            row.year,
            row.title or row.filename,
        )

    async def chunks(self, org_id: UUID, source_id: UUID) -> list[ChunkFacts]:
        c, p = t_chunks, t_pages
        query = (
            select(c, p.c.page_label)
            .select_from(c.outerjoin(p, and_(p.c.source_id == c.c.source_id, p.c.page_no == c.c.page_start)))
            .where(c.c.source_id == source_id)
            .order_by(c.c.position)
        )
        async with org_transaction(self._engine, org_id) as conn:
            rows = (await conn.execute(query)).all()
            tags = (
                await conn.execute(
                    select(t_chunk_tags).where(t_chunk_tags.c.chunk_id.in_([row.id for row in rows]))
                )
            ).all()
        by_chunk: dict[UUID, list[IndexTag]] = {}
        for tag in tags:
            by_chunk.setdefault(tag.chunk_id, []).append(
                IndexTag(tag.node_id, tag.method, tag.confidence, tag.is_primary)
            )
        return [
            ChunkFacts(
                row.id,
                row.position,
                row.kind,
                row.text,
                row.context_header,
                row.heading_path,
                row.page_start,
                row.page_end,
                row.page_label,
                row.language,
                row.content_hash or "",
                tuple(by_chunk.get(row.id, [])),
            )
            for row in rows
        ]

    async def ancestors(self, org_id: UUID) -> dict[UUID, list[UUID]]:
        nodes = await self._syllabus.nodes(org_id)
        parent = {node.id: node.parent_id for node in nodes}
        result: dict[UUID, list[UUID]] = {}
        for node in nodes:
            chain: list[UUID] = []
            current = parent.get(node.id)
            while current is not None and current not in chain:
                chain.append(current)
                current = parent.get(current)
            result[node.id] = chain
        return result

    async def mark_indexed(self, org_id: UUID, chunk_ids: Sequence[UUID]) -> None:
        if not chunk_ids:
            return
        async with org_transaction(self._engine, org_id) as conn:
            await conn.execute(
                update(t_chunks).where(t_chunks.c.id.in_(chunk_ids)).values(indexed_at=func.now())
            )


class SqlOutbox:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def next(self, limit: int) -> list[OutboxItem]:
        o = t_index_outbox
        query = (
            select(o)
            .where(o.c.processed_at.is_(None), o.c.attempts < MAX_ATTEMPTS)
            .order_by(o.c.id)
            .limit(limit)
        )
        async with self._engine.connect() as conn:
            rows = (await conn.execute(query)).all()
        return [
            OutboxItem(
                row.id,
                row.org_id,
                cast(Literal["source", "chunk", "question"], row.entity),
                row.entity_id,
                cast(Literal["delete", "update_payload"], row.op),
                row.payload,
            )
            for row in rows
        ]

    async def done(self, item_id: int) -> None:
        async with self._engine.begin() as conn:
            await conn.execute(
                update(t_index_outbox).where(t_index_outbox.c.id == item_id).values(processed_at=func.now())
            )

    async def failed(self, item_id: int, error: str) -> None:
        o = t_index_outbox
        async with self._engine.begin() as conn:
            await conn.execute(
                update(o).where(o.c.id == item_id).values(attempts=o.c.attempts + 1, last_error=error[:2000])
            )

    async def backlog(self) -> int:
        """Rows not yet applied (System health warns when it grows)."""
        o = t_index_outbox
        async with self._engine.connect() as conn:
            return int(
                (
                    await conn.execute(select(func.count()).select_from(o).where(o.c.processed_at.is_(None)))
                ).scalar_one()
            )


class SqlWaitingSources:
    """Files left behind while the model server was down, or embedded by an older model. Looked up center by
    center: `sources` has row-level security."""

    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def waiting(self, version: str, limit: int) -> list[tuple[UUID, UUID]]:
        async with self._engine.connect() as conn:
            orgs = [row.id for row in await conn.execute(select(t_organizations.c.id))]
        s, c = t_sources, t_chunks
        behind = exists().where(
            c.c.source_id == s.c.id,
            or_(c.c.embedding_version_id.is_distinct_from(version), c.c.indexed_at.is_(None)),
        )
        query = (
            select(s.c.id)
            .where(
                s.c.stage.in_(_READ_STAGES),
                s.c.status.not_in(("running", "failed")),
                s.c.updated_at < func.now() - text(f"interval '{SETTLED}'"),
                behind,
            )
            .order_by(s.c.updated_at)
        )
        found: list[tuple[UUID, UUID]] = []
        for org_id in orgs:
            if len(found) >= limit:
                break
            async with org_transaction(self._engine, org_id) as conn:
                rows = (await conn.execute(query.limit(limit - len(found)))).all()
            found.extend((org_id, row.id) for row in rows)
        return found
