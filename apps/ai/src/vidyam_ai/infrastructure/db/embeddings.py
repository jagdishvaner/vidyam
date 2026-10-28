"""Postgres adapter for embedding: a file's chunks, which version embedded them, and the registry of versions
(`embedding_versions`, global)."""

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncEngine

from vidyam_ai.application.embedding import ChunkToEmbed
from vidyam_ai.domain.embeddings import EmbeddingVersion
from vidyam_ai.infrastructure.db.engine import org_transaction
from vidyam_ai.infrastructure.db.generated.tables import t_chunks, t_embedding_versions


class SqlEmbeddingStore:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def chunks(self, org_id: UUID, source_id: UUID) -> list[ChunkToEmbed]:
        c = t_chunks
        query = (
            select(c.c.id, c.c.text, c.c.context_header, c.c.content_hash)
            .where(c.c.source_id == source_id)
            .order_by(c.c.position)
        )
        async with org_transaction(self._engine, org_id) as conn:
            rows = (await conn.execute(query)).all()
        return [ChunkToEmbed(row.id, row.text, row.context_header, row.content_hash or "") for row in rows]

    async def mark_embedded(self, org_id: UUID, chunk_ids: Sequence[UUID], version: EmbeddingVersion) -> None:
        if not chunk_ids:
            return
        async with org_transaction(self._engine, org_id) as conn:
            await conn.execute(
                update(t_chunks).where(t_chunks.c.id.in_(chunk_ids)).values(embedding_version_id=version.id)
            )


async def register_version(engine: AsyncEngine, version: EmbeddingVersion) -> None:
    """Records the configured model as the active embedding version; earlier ones stay, inactive, so their
    vectors are known for what they are."""
    t = t_embedding_versions
    async with engine.begin() as conn:
        await conn.execute(update(t).where(t.c.id != version.id).values(is_active=False))
        await conn.execute(
            pg_insert(t)
            .values(
                id=version.id,
                provider=version.provider,
                model=version.model,
                dims=version.dims,
                is_active=True,
            )
            .on_conflict_do_update(index_elements=[t.c.id], set_={"is_active": True})
        )
