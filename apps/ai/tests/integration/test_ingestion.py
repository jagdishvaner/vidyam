"""End to end (ADR 0014): `pnpm ingest` stores files and starts workflows from TypeScript, the Python
workers read them, and the text lands in Postgres under the right organization. Runs in a throwaway
organization on its own task queues, and removes everything it created."""

import asyncio
import os
from contextlib import AsyncExitStack
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine
from vidyam_ai.config import REPO_ROOT, get_settings
from vidyam_ai.infrastructure.db.generated.tables import t_chunks, t_pages, t_sources
from vidyam_ai.infrastructure.resources import create_s3
from vidyam_ai.infrastructure.temporal.client import connect, wait_for_namespace
from vidyam_ai.interface.workflows.worker import create_workers, open_activities

from tests.fixtures.documents import krutidev_pdf, scanned_pdf


def _admin_url() -> str:
    url = os.environ.get("VIDYAM_DATABASE_ADMIN_URL")
    if not url:
        for line in (REPO_ROOT / ".env").read_text().splitlines():
            if line.startswith("VIDYAM_DATABASE_ADMIN_URL="):
                url = line.split("=", 1)[1]
    assert url, "VIDYAM_DATABASE_ADMIN_URL is required"
    return url.replace("postgresql://", "postgresql+asyncpg://", 1)


async def test_ingest_command_reads_files_into_the_organizations_library(tmp_path: Path) -> None:
    settings = get_settings()
    folder = tmp_path / "library"
    (folder / "polity").mkdir(parents=True)
    krutidev_pdf(
        folder / "polity" / "notes.pdf", ["Hkkjr dk lafo/kku 26 tuojh 1950 dks ykxw gqvk Fkk"], ["Chapter 1"]
    )
    scanned_pdf(folder / "scan.pdf")
    (folder / "scan.png").unlink()  # only the PDF is content

    owner = create_async_engine(_admin_url())
    org_id, slug = uuid4(), f"ingest-test-{uuid4().hex[:8]}"
    async with owner.begin() as conn:
        await conn.execute(
            text("insert into organizations (id, name, slug, created_at) values (:id, 'Test', :s, now())"),
            {"id": org_id, "s": slug},
        )
    client = await connect(settings)
    await wait_for_namespace(client)
    prefix = f"ingest-test-{uuid4().hex[:8]}-"
    try:
        async with open_activities(settings) as activities, AsyncExitStack() as running:
            for worker in create_workers(client, activities, task_queue_prefix=prefix):
                await running.enter_async_context(worker)
            command = await asyncio.create_subprocess_exec(
                *("pnpm", "--silent", "--filter", "@vidyam/api", "ingest", str(folder)),
                *("--kind", "notes", "--licence", "own", "--meta", "exam=rpsc", "--org", slug),
                *("--task-queue", f"{prefix}ai", "--wait"),
                cwd=REPO_ROOT,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(command.communicate(), timeout=180)
        output = stdout.decode()
        assert command.returncode == 0, stderr.decode() + output
        assert "polity/notes.pdf: 1 page (0 text, 1 Kruti Dev) → 1 passage in 1 section, 0 tagged" in output
        assert "scan.pdf: 1 page (0 text, 1 waiting for OCR) → 0 passages, 0 tagged" in output

        async with owner.connect() as conn:
            sources = {
                row.filename: row
                for row in await conn.execute(select(t_sources).where(t_sources.c.org_id == org_id))
            }
            [chunk] = (await conn.execute(select(t_chunks).where(t_chunks.c.org_id == org_id))).all()
            [ocr_page] = (
                await conn.execute(select(t_pages).where(t_pages.c.source_id == sources["scan.pdf"].id))
            ).all()
        # "embedded" too when the model servers are running (pnpm models:up).
        assert sources["notes.pdf"].stage in ("tagged", "embedded") and sources["notes.pdf"].status == "done"
        assert sources["notes.pdf"].meta == {"exam": "rpsc"}
        assert sources["scan.pdf"].stage in ("tagged", "embedded") and sources["scan.pdf"].status == "pending"
        # "Chapter 1" is a heading: it leads the chunk's heading path instead of its text.
        assert chunk.text == "भारत का संविधान 26 जनवरी 1950 को लागू हुआ था"
        assert (chunk.heading_path, chunk.kind) == ("Chapter 1", "prose")
        assert chunk.source_id == sources["notes.pdf"].id
        assert ocr_page.meta["awaitingOcr"] is True

        # Importing the same folder again reads nothing twice.
        again = await asyncio.create_subprocess_exec(
            *("pnpm", "--silent", "--filter", "@vidyam/api", "ingest", str(folder)),
            *("--kind", "notes", "--licence", "own", "--org", slug, "--task-queue", f"{prefix}ai"),
            cwd=REPO_ROOT,
            stdout=asyncio.subprocess.PIPE,
        )
        assert (await again.communicate())[0].decode().count("already imported") == 2
    finally:
        s3 = create_s3(settings)
        for bucket in (settings.bucket(kind) for kind in ("raw", "derived", "embeddings")):
            listed = s3.list_objects_v2(Bucket=bucket, Prefix=f"org/{org_id}/")
            keys = [{"Key": item["Key"]} for item in listed.get("Contents", [])]
            if keys:
                s3.delete_objects(Bucket=bucket, Delete={"Objects": keys})
        async with owner.begin() as conn:
            await conn.execute(text("delete from organizations where id = :id"), {"id": org_id})
        await owner.dispose()
