"""The organization's syllabus tree, read whole: a center has a few thousand nodes at most, so paths and
subtrees are worked out in memory from one query."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine

from vidyam_ai.domain.sections import SyllabusNode
from vidyam_ai.infrastructure.db.engine import org_transaction
from vidyam_ai.infrastructure.db.generated.tables import t_taxonomy_nodes


class SqlSyllabus:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def nodes(self, org_id: UUID) -> list[SyllabusNode]:
        """Every active node, with its code path, in the editor's order."""
        t = t_taxonomy_nodes
        query = (
            select(t.c.id, t.c.parent_id, t.c.level, t.c.code, t.c.name_en, t.c.name_hi, t.c.aliases)
            .where(t.c.is_active)
            .order_by(t.c.sort_order, t.c.name_en)
        )
        async with org_transaction(self._engine, org_id) as conn:
            rows = (await conn.execute(query)).all()
        by_id = {row.id: row for row in rows}
        paths: dict[UUID, str] = {}

        def path(node_id: UUID) -> str:
            if node_id not in paths:
                row = by_id[node_id]
                parent = row.parent_id if row.parent_id in by_id else None
                paths[node_id] = f"{path(parent)}/{row.code}" if parent else row.code
            return paths[node_id]

        return [
            SyllabusNode(
                row.id, row.parent_id, row.level, path(row.id), row.name_en, row.name_hi, tuple(row.aliases)
            )
            for row in rows
        ]

    async def subtree(self, org_id: UUID, root_id: UUID | None) -> list[SyllabusNode]:
        nodes = await self.nodes(org_id)
        if root_id is None:
            return nodes
        root = next((node for node in nodes if node.id == root_id), None)
        if root is None:
            return []
        return [node for node in nodes if node.path == root.path or node.path.startswith(f"{root.path}/")]
