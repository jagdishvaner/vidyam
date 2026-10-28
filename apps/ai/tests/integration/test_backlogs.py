"""The backlogs end to end on the stub model (plan v3 §5, §8): the demo pack is imported with its manifest,
each backlog is estimated, then run through RunBacklog → LlmBatch on Temporal. The paper is split into its 30
bilingual questions with the answers from its key, chunks and questions get topics, and scanned pages stay
waiting for a real vision model. Runs in a throwaway organization on its own task queues."""

import shutil
from contextlib import AsyncExitStack
from pathlib import Path
from typing import Any
from uuid import uuid4

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import create_async_engine
from vidyam_ai.application.backlogs import Backlogs
from vidyam_ai.config import get_settings
from vidyam_ai.infrastructure.db.backlogs import SqlBacklogStore
from vidyam_ai.infrastructure.db.engine import create_engine
from vidyam_ai.infrastructure.db.generated.tables import (
    t_chunk_tags,
    t_chunks,
    t_pages,
    t_pyq_refs,
    t_question_tags,
    t_questions,
    t_sources,
)
from vidyam_ai.infrastructure.db.sources import SqlSources
from vidyam_ai.infrastructure.db.syllabus import SqlSyllabus
from vidyam_ai.infrastructure.llm import create_llm_gateway
from vidyam_ai.infrastructure.resources import create_s3
from vidyam_ai.infrastructure.s3.page_images import S3PageImages
from vidyam_ai.infrastructure.temporal.client import connect, wait_for_namespace
from vidyam_ai.interface.workflows.worker import create_workers, open_activities

from tests.integration.cleanup import remove_org
from tests.integration.test_manifest_ingestion import PACK, _ingest, _seed_catalog
from tests.integration.test_rls import _admin_url


async def test_backlogs_estimate_and_run_on_the_stub(tmp_path: Path) -> None:
    settings = get_settings().model_copy(update={"ai_stub": True})  # never a real provider, keys or not
    shutil.copytree(PACK / "files", tmp_path / "files")
    (tmp_path / "manifest.csv").write_text((PACK / "manifest.csv").read_text())
    owner = create_async_engine(_admin_url())
    app = create_engine(settings.async_database_url)
    org_id, slug = uuid4(), f"backlog-test-{uuid4().hex[:8]}"
    async with owner.begin() as conn:
        await conn.execute(
            text("insert into organizations (id, name, slug, created_at) values (:id, 'Test', :s, now())"),
            {"id": org_id, "s": slug},
        )
        await _seed_catalog(conn, org_id)
    syllabus = SqlSyllabus(app)
    store = SqlBacklogStore(app, SqlSources(app), syllabus)
    backlogs = Backlogs(
        create_llm_gateway(settings, app),
        store,
        syllabus,
        S3PageImages(create_s3(settings), settings.bucket("derived")),
    )
    client = await connect(settings)
    await wait_for_namespace(client)
    prefix = f"backlog-test-{uuid4().hex[:8]}-"

    async def run(kind: str) -> dict[str, Any]:
        return await client.execute_workflow(
            "RunBacklog",
            {"v": 1, "orgId": str(org_id), "requestedBy": None, "kind": kind, "limit": None},
            id=f"RunBacklog:{org_id}:{kind}",
            task_queue=f"{prefix}ai",
        )

    try:
        async with open_activities(settings) as activities, AsyncExitStack() as running:
            for worker in create_workers(client, activities, task_queue_prefix=prefix):
                await running.enter_async_context(worker)
            code, output, errors = await _ingest(tmp_path / "manifest.csv", slug, f"{prefix}ai")
            assert code == 0, errors + output

            ocr, segment, tag = [await backlogs.estimate(org_id, kind) for kind in ("ocr", "segment", "tag")]
            assert (ocr.items, ocr.requests, ocr.provider, ocr.cost_usd, ocr.blocked) == (
                3,
                3,
                "stub",
                0,
                None,
            )
            assert (segment.items, segment.requests) == (1, 2)  # one paper of 8 pages: two windows of 4
            assert segment.model_id is not None and tag.items > 20 and tag.blocked is None

            result = await run("segment")
            assert (result["kind"], result["items"], result["succeeded"], result["failed"]) == (
                "segment",
                1,
                2,
                0,
            )
            async with owner.connect() as conn:
                paper = (
                    await conn.execute(
                        select(t_sources.c.id).where(
                            t_sources.c.org_id == org_id,
                            t_sources.c.filename == "science-test-2025-set-a.pdf",
                        )
                    )
                ).scalar_one()
                refs = (
                    await conn.execute(
                        select(t_pyq_refs, t_questions.c.content, t_questions.c.answer, t_questions.c.qtype)
                        .join(t_questions, t_questions.c.id == t_pyq_refs.c.question_id)
                        .where(t_pyq_refs.c.source_id == paper)
                        .order_by(t_pyq_refs.c.question_no)
                    )
                ).all()
            # Every question, in both languages, with the answer from the final key (1. C … 30. D).
            assert [ref.question_no for ref in refs] == list(range(1, 31))
            assert all(ref.set_code == "A" and ref.content["hi"] and ref.content["en"] for ref in refs)
            assert (refs[0].qtype, refs[0].answer, refs[0].key_status) == (
                "statement",
                {"kind": "options", "keys": ["C"]},
                "final",
            )
            assert refs[-1].answer == {"kind": "options", "keys": ["D"]}

            result = await run("tag")
            assert result["failed"] == 0 and result["succeeded"] == tag.items + 30  # the new questions too
            async with owner.connect() as conn:
                unchecked = (
                    await conn.execute(
                        select(func.count())
                        .select_from(t_chunks)
                        .where(t_chunks.c.org_id == org_id, t_chunks.c.topics_checked_at.is_(None))
                    )
                ).scalar_one()
                topics = (
                    await conn.execute(
                        select(func.count())
                        .select_from(t_chunk_tags)
                        .where(t_chunk_tags.c.org_id == org_id, t_chunk_tags.c.method == "llm")
                    )
                ).scalar_one()
                question_topics = (
                    await conn.execute(
                        select(func.count())
                        .select_from(t_question_tags)
                        .where(t_question_tags.c.org_id == org_id, t_question_tags.c.method == "llm")
                    )
                ).scalar_one()
            assert unchecked == 0 and topics > 10 and question_topics > 10

            result = await run("ocr")
            assert (result["items"], result["succeeded"]) == (3, 3)
            async with owner.connect() as conn:
                scan_pages = (
                    await conn.execute(
                        select(t_pages.c.meta)
                        .join(t_sources, t_sources.c.id == t_pages.c.source_id)
                        .where(t_sources.c.org_id == org_id, t_sources.c.filename.like("%scan%"))
                    )
                ).all()
            # The stub can't see images: each page records the attempt and keeps waiting for a vision model.
            assert len(scan_pages) == 3
            assert all(p.meta["awaitingOcr"] and p.meta["lastOcr"]["provider"] == "stub" for p in scan_pages)

            after = [await backlogs.estimate(org_id, kind) for kind in ("ocr", "segment", "tag")]
            assert [estimate.items for estimate in after] == [3, 0, 0]
    finally:
        await remove_org(settings, owner, org_id)
        await owner.dispose()
        await app.dispose()
