"""End to end with a manifest (plan v3 §5): `pnpm ingest --manifest` checks the demo pack against the
syllabus, stores every file with its typed metadata, and the Python workers read each into pages with images,
sections, chunks under their headings and rule tags. Editing the manifest and importing again re-tags a file
without uploading it twice. Runs in a throwaway organization on its own task queues, and removes everything
it created."""

import asyncio
import json
import shutil
from contextlib import AsyncExitStack
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
from vidyam_ai.config import REPO_ROOT, get_settings
from vidyam_ai.infrastructure.db.generated.tables import (
    t_chunk_tags,
    t_chunks,
    t_pages,
    t_source_sections,
    t_sources,
    t_taxonomy_nodes,
)
from vidyam_ai.infrastructure.resources import create_s3
from vidyam_ai.infrastructure.temporal.client import connect, wait_for_namespace
from vidyam_ai.interface.workflows.worker import create_workers, open_activities

from tests.integration.test_rls import _admin_url

PACK = REPO_ROOT / "fixtures" / "demo-pack"


async def _seed_catalog(conn: AsyncConnection, org_id: UUID) -> None:
    """The demo pack's syllabus and exam paper, as an admin would import them."""

    async def node(raw: dict[str, Any], parent: UUID | None, order: int) -> None:
        node_id = uuid4()
        await conn.execute(
            text(
                "insert into taxonomy_nodes (id, org_id, parent_id, level, code, name_en, name_hi, aliases,"
                " sort_order) values (:id, :org, :parent, :level, :code, :en, :hi, :aliases, :order)"
            ),
            {
                "id": node_id,
                "org": org_id,
                "parent": parent,
                "level": raw["level"],
                "code": raw["code"],
                "en": raw["nameEn"],
                "hi": raw.get("nameHi"),
                "aliases": raw.get("aliases", []),
                "order": order,
            },
        )
        for n, child in enumerate(raw.get("children", [])):
            await node(child, node_id, n)

    await node(json.loads((PACK / "catalog" / "syllabus-science.json").read_text())["subject"], None, 0)
    for exam in json.loads((PACK / "catalog" / "exams.json").read_text()):
        await conn.execute(
            text("insert into exams (org_id, code, family, name_en) values (:org, :code, :family, :name)"),
            {"org": org_id, "code": exam["code"], "family": exam["family"], "name": exam["nameEn"]},
        )


async def _ingest(manifest: Path, slug: str, queue: str) -> tuple[int, str, str]:
    command = await asyncio.create_subprocess_exec(
        *("pnpm", "--silent", "--filter", "@vidyam/api", "ingest", "--manifest", str(manifest)),
        *("--org", slug, "--task-queue", queue, "--wait"),
        cwd=REPO_ROOT,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(command.communicate(), timeout=300)
    return command.returncode or 0, stdout.decode(), stderr.decode()


async def test_manifest_import_reads_tags_and_retags_the_demo_pack(tmp_path: Path) -> None:
    settings = get_settings()
    shutil.copytree(PACK / "files", tmp_path / "files")
    manifest = tmp_path / "manifest.csv"
    manifest.write_text((PACK / "manifest.csv").read_text())

    owner = create_async_engine(_admin_url())
    org_id, slug = uuid4(), f"manifest-test-{uuid4().hex[:8]}"
    async with owner.begin() as conn:
        await conn.execute(
            text("insert into organizations (id, name, slug, created_at) values (:id, 'Test', :s, now())"),
            {"id": org_id, "s": slug},
        )
        await _seed_catalog(conn, org_id)
    client = await connect(settings)
    await wait_for_namespace(client)
    prefix = f"manifest-test-{uuid4().hex[:8]}-"
    try:
        async with open_activities(settings) as activities, AsyncExitStack() as running:
            for worker in create_workers(client, activities, task_queue_prefix=prefix):
                await running.enter_async_context(worker)

            # A manifest with a mistake imports nothing, and says where the mistake is.
            broken = tmp_path / "broken.csv"
            broken.write_text(
                manifest.read_text().replace("science/physics/electricity", "science/physics/optics")
            )
            code, _, errors = await _ingest(broken, slug, f"{prefix}ai")
            assert code == 1
            assert 'line 7 (files/physics-electricity-en.docx): chapter "science/physics/optics"' in errors

            code, output, errors = await _ingest(manifest, slug, f"{prefix}ai")
            assert code == 0, errors + output
            assert "manifest.csv: 10 files checked against the syllabus and exams." in output
            assert output.count("started ") == 10
            assert (
                "done             files/physics-motion-force-hi.pdf: 8 pages (8 text) → " in output
                and " in 2 sections, " in output
            )
            assert "files/chemistry-acids-bases-salts-scan.pdf: 3 pages (0 text, 3 waiting for OCR)" in output

            async with owner.connect() as conn:
                sources = {
                    Path(row.filename).name: row
                    for row in await conn.execute(select(t_sources).where(t_sources.c.org_id == org_id))
                }
                nodes = {
                    row.id: row.code
                    for row in await conn.execute(
                        select(t_taxonomy_nodes).where(t_taxonomy_nodes.c.org_id == org_id)
                    )
                }
                motion_force = sources["physics-motion-force-hi.pdf"]
                sections = (
                    await conn.execute(
                        select(t_source_sections)
                        .where(t_source_sections.c.source_id == motion_force.id)
                        .order_by(t_source_sections.c.position)
                    )
                ).all()
                tagged = (
                    await conn.execute(
                        select(
                            t_chunks.c.page_start,
                            t_chunks.c.kind,
                            t_chunk_tags.c.node_id,
                            t_chunk_tags.c.method,
                        )
                        .join(t_chunk_tags, t_chunk_tags.c.chunk_id == t_chunks.c.id)
                        .where(t_chunks.c.source_id == motion_force.id, t_chunk_tags.c.is_primary)
                    )
                ).all()
                docx_chunks = (
                    await conn.execute(
                        select(t_chunks).where(
                            t_chunks.c.source_id == sources["physics-electricity-en.docx"].id
                        )
                    )
                ).all()
                book_pages = (
                    await conn.execute(
                        select(t_pages.c.page_no, t_pages.c.page_label, t_pages.c.image_s_3_key)
                        .where(t_pages.c.source_id == sources["biology-cell-life-processes-hi.pdf"].id)
                        .order_by(t_pages.c.page_no)
                    )
                ).all()
                paper_kinds = {
                    row.kind
                    for row in await conn.execute(
                        select(t_chunks.c.kind).where(
                            t_chunks.c.source_id == sources["science-test-2025-set-a.pdf"].id
                        )
                    )
                }

            # Typed metadata from the manifest, with the links between files resolved.
            key, paper = sources["science-test-2025-set-a-key.pdf"], sources["science-test-2025-set-a.pdf"]
            assert key.answer_key_for_source_id == paper.id and key.set_code == "A"
            assert paper.year == 2025 and paper.exam_codes == ["rpsc_2g_p2_science"]
            en, hi = sources["physics-work-energy-en.pdf"], sources["physics-work-energy-hi.pdf"]
            assert en.parallel_group_id is not None and en.parallel_group_id == hi.parallel_group_id
            assert nodes[motion_force.subject_node_id] == "science" and motion_force.language == "hi"
            assert motion_force.manifest_batch_id is not None
            assert (motion_force.stage, motion_force.status) == ("tagged", "done")
            assert (sources["chemistry-acids-bases-salts-scan.pdf"].stage,) == ("tagged",)

            # Sections from the manifest's page ranges; every chunk tagged with the chapter its pages cover.
            assert [(s.page_start, s.page_end, nodes[s.node_id], s.origin) for s in sections] == [
                (1, 4, "motion", "manifest"),
                (5, 8, "force_and_laws_of_motion", "manifest"),
            ]
            assert tagged and all(
                nodes[row.node_id] == ("motion" if row.page_start <= 4 else "force_and_laws_of_motion")
                and row.method == "manifest"
                for row in tagged
            )
            # Word headings become heading paths and context headers; question papers chunk as questions.
            assert docx_chunks and all(
                c.heading_path.startswith("Chapter 12: Electricity") for c in docx_chunks
            )
            assert docx_chunks[0].context_header.startswith("Electricity — Notes › Chapter 12: Electricity")
            assert "question" in paper_kinds
            # Printed page numbers from the manifest's page offset; a page image for every PDF page.
            assert [(p.page_no, p.page_label) for p in book_pages][:2] == [(1, "41"), (2, "42")]
            book = sources["biology-cell-life-processes-hi.pdf"]
            assert all(p.image_s_3_key == f"org/{org_id}/pages/{book.id}/{p.page_no}.png" for p in book_pages)

            # The same manifest again: nothing to do.
            code, output, _ = await _ingest(manifest, slug, f"{prefix}ai")
            assert code == 0 and output.count("already imported") == 10

            # A corrected chapter re-tags that file from its stored pages; nothing is uploaded again.
            manifest.write_text(
                manifest.read_text().replace(
                    "Electricity — Notes,10,,,,,,science/physics/electricity",
                    "Electricity — Notes,10,,,,,,science/physics/work_and_energy",
                )
            )
            code, output, errors = await _ingest(manifest, slug, f"{prefix}ai")
            assert code == 0, errors + output
            assert "updated          files/physics-electricity-en.docx" in output
            assert output.count("already imported") == 9
            async with owner.connect() as conn:
                retagged = {
                    nodes[row.node_id]
                    for row in await conn.execute(
                        select(t_chunk_tags.c.node_id)
                        .join(t_chunks, t_chunks.c.id == t_chunk_tags.c.chunk_id)
                        .where(t_chunks.c.source_id == sources["physics-electricity-en.docx"].id)
                    )
                }
            assert retagged == {"work_and_energy"}
    finally:
        s3 = create_s3(settings)
        for bucket in (settings.bucket("raw"), settings.bucket("derived")):
            listed = s3.list_objects_v2(Bucket=bucket, Prefix=f"org/{org_id}/")
            keys = [{"Key": item["Key"]} for item in listed.get("Contents", [])]
            if keys:
                s3.delete_objects(Bucket=bucket, Delete={"Objects": keys})
        async with owner.begin() as conn:
            await conn.execute(text("delete from organizations where id = :id"), {"id": org_id})
        await owner.dispose()
