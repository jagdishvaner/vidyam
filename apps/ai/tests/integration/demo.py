"""The demo pack read into a throwaway organization by real workers, for tests that need searchable content.
Needs the model servers (`pnpm models:up`); callers skip without them. Everything it created is removed."""

import shutil
from collections.abc import AsyncGenerator
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from temporalio.client import Client
from vidyam_ai.config import get_settings
from vidyam_ai.infrastructure.temporal.client import connect, wait_for_namespace
from vidyam_ai.interface.workflows.worker import AllActivities, create_workers, open_activities

from tests.integration.cleanup import remove_org
from tests.integration.test_manifest_ingestion import PACK, _ingest, _seed_catalog
from tests.integration.test_rls import _admin_url


@dataclass(frozen=True)
class DemoOrg:
    org_id: UUID
    owner: AsyncEngine  # the tables' owner: reads past row-level security
    activities: AllActivities
    client: Client
    task_queue: str  # the test workers' "ai" queue
    output: str  # what `pnpm ingest` printed


@asynccontextmanager
async def demo_org(tmp_path: Path, name: str) -> AsyncGenerator[DemoOrg]:
    settings = get_settings()
    shutil.copytree(PACK / "files", tmp_path / "files")
    (tmp_path / "manifest.csv").write_text((PACK / "manifest.csv").read_text())
    owner = create_async_engine(_admin_url())
    org_id, slug = uuid4(), f"{name}-{uuid4().hex[:8]}"
    async with owner.begin() as conn:
        await conn.execute(
            text("insert into organizations (id, name, slug, created_at) values (:id, 'Test', :s, now())"),
            {"id": org_id, "s": slug},
        )
        await _seed_catalog(conn, org_id)
    client = await connect(settings)
    await wait_for_namespace(client)
    prefix = f"{slug}-"
    try:
        async with open_activities(settings) as activities, AsyncExitStack() as running:
            for worker in create_workers(client, activities, task_queue_prefix=prefix):
                await running.enter_async_context(worker)
            code, output, errors = await _ingest(tmp_path / "manifest.csv", slug, f"{prefix}ai")
            assert code == 0, errors + output
            yield DemoOrg(org_id, owner, activities, client, f"{prefix}ai", output)
    finally:
        await remove_org(settings, owner, org_id)
        await owner.dispose()
