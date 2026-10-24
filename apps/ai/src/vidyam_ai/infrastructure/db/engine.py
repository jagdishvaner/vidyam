from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine


def create_engine(url: str) -> AsyncEngine:
    """Connects as the runtime role (vidyam_app), so Postgres row-level security applies."""
    return create_async_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=5)


@asynccontextmanager
async def org_transaction(engine: AsyncEngine, org_id: UUID) -> AsyncGenerator[AsyncConnection]:
    """A transaction scoped to one organization: every statement sees only that organization's rows."""
    async with engine.begin() as conn:
        await conn.execute(text("select set_config('app.org_id', :org_id, true)"), {"org_id": str(org_id)})
        yield conn
