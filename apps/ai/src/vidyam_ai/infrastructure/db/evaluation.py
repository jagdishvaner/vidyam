"""What the retrieval eval reads about a center's library (plan v3 step 21), under its row-level security."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine

from vidyam_ai.domain.sections import SyllabusNode
from vidyam_ai.infrastructure.db.engine import org_transaction
from vidyam_ai.infrastructure.db.generated.tables import t_chunks, t_sources
from vidyam_ai.infrastructure.db.syllabus import SqlSyllabus


class SqlEvalCorpus:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine
        self._syllabus = SqlSyllabus(engine)

    async def file_names(self, org_id: UUID) -> dict[UUID, str]:
        async with org_transaction(self._engine, org_id) as conn:
            rows = await conn.execute(select(t_sources.c.id, t_sources.c.filename))
            return {row.id: row.filename for row in rows}

    async def searchable(self, org_id: UUID) -> set[UUID]:
        query = select(t_chunks.c.source_id).where(t_chunks.c.indexed_at.is_not(None)).distinct()
        async with org_transaction(self._engine, org_id) as conn:
            return set((await conn.execute(query)).scalars())

    async def nodes(self, org_id: UUID) -> list[SyllabusNode]:
        return await self._syllabus.nodes(org_id)
