"""The search index end to end (plan v3 §5 steps 9–10, ADR 0018), with the real Qwen3 model servers
(`pnpm models:up`; skipped without them). The demo pack is imported with its manifest; every chunk becomes a
point in Qdrant that filters by chapter, matches Hindi and Hinglish keywords, and is found by meaning; content
is counted per syllabus node; a removed file leaves search through the outbox; and a file left behind is
indexed by the keeper. Runs in a throwaway organization, and removes everything it created."""

from pathlib import Path

import httpx
import pytest
from qdrant_client import models
from sqlalchemy import select, text
from vidyam_ai.config import get_settings
from vidyam_ai.domain.embeddings import RETRIEVE_PASSAGES, query_text
from vidyam_ai.domain.lexical import normalize, romanized
from vidyam_ai.infrastructure.db.engine import org_transaction
from vidyam_ai.infrastructure.db.generated.tables import t_chunks, t_sources, t_taxonomy_nodes
from vidyam_ai.infrastructure.models import create_embedder
from vidyam_ai.infrastructure.qdrant.collections import DENSE
from vidyam_ai.infrastructure.resources import create_qdrant
from vidyam_ai.interface.workflows.upkeep import IndexKeeper

from tests.integration.demo import demo_org
from tests.integration.test_manifest_ingestion import embedder_ready


def _org(org_id: object) -> models.FieldCondition:
    return models.FieldCondition(key="org_id", match=models.MatchValue(value=str(org_id)))


async def test_the_demo_pack_is_searchable_by_chapter_keyword_and_meaning(tmp_path: Path) -> None:
    settings = get_settings()
    if not await embedder_ready(settings):
        pytest.skip("the model servers aren't running (pnpm models:up)")
    qdrant = create_qdrant(settings)
    try:
        async with demo_org(tmp_path, "index-test") as demo:
            org_id, owner, activities, client = demo.org_id, demo.owner, demo.activities, demo.client
            assert "searchable" in demo.output

            async with owner.connect() as conn:
                chunks = (await conn.execute(select(t_chunks).where(t_chunks.c.org_id == org_id))).all()
                sources = {
                    Path(row.filename).name: row
                    for row in await conn.execute(select(t_sources).where(t_sources.c.org_id == org_id))
                }
                nodes = {
                    row.code: row.id
                    for row in await conn.execute(
                        select(t_taxonomy_nodes).where(t_taxonomy_nodes.c.org_id == org_id)
                    )
                }
            mine = models.Filter(must=[_org(org_id)])
            points = (await qdrant.count("chunks", count_filter=mine, exact=True)).count
            assert points == len(chunks) > 50 and all(chunk.indexed_at for chunk in chunks)

            # A chapter filter finds that chapter's text; the subject finds everything.
            motion = models.Filter(
                must=[
                    _org(org_id),
                    models.FieldCondition(
                        key="taxonomy_node_ids", match=models.MatchValue(value=str(nodes["motion"]))
                    ),
                ]
            )
            hits, _ = await qdrant.scroll("chunks", scroll_filter=motion, limit=100, with_payload=True)
            motion_force = str(sources["physics-motion-force-hi.pdf"].id)
            assert hits and all(hit.payload and hit.payload["source_id"] == motion_force for hit in hits)
            science = models.Filter(
                must=[
                    _org(org_id),
                    models.FieldCondition(
                        key="taxonomy_node_ids", match=models.MatchValue(value=str(nodes["science"]))
                    ),
                ]
            )
            assert (await qdrant.count("chunks", count_filter=science, exact=True)).count == points

            # Keywords: Hindi as written, and the same word typed in Hinglish.
            for field, query in (("lex", normalize("त्वरण")), ("lex_roman", romanized("twaran"))):
                keyword = models.Filter(
                    must=[_org(org_id), models.FieldCondition(key=field, match=models.MatchText(text=query))]
                )
                assert (await qdrant.count("chunks", count_filter=keyword, exact=True)).count > 0, field

            # Meaning: an English question finds the Hindi passage on acceleration's unit.
            async with httpx.AsyncClient() as http:
                [vector] = await create_embedder(settings, http).embed(
                    [query_text(RETRIEVE_PASSAGES, "What is the SI unit of acceleration?")]
                )
            found = await qdrant.query_points("chunks", query=vector, using=DENSE, query_filter=mine, limit=3)
            assert any(p.payload and "m/s²" in p.payload["text"] for p in found.points)

            # Content counts per node, including what sits below it.
            async with org_transaction(owner, org_id) as conn:
                counts = {
                    (row.node_id, row.item): row.total
                    for row in await conn.execute(
                        text(
                            "select node_id, item, sum(items) as total from coverage_stats "
                            "group by node_id, item"
                        )
                    )
                }
            assert counts[(nodes["motion"], "chunk")] == len(hits)
            assert counts[(nodes["science"], "chunk")] == points

            # Removing a file in the app queues an outbox row; the keeper's pass takes it out of search.
            removed = sources["physics-work-energy-en.pdf"].id
            async with owner.begin() as conn:
                await conn.execute(
                    text(
                        "insert into index_outbox (org_id, entity, entity_id, op) "
                        "values (:o, 'source', :s, 'delete')"
                    ),
                    {"o": org_id, "s": removed},
                )
            await activities.outbox.execute()
            gone = models.Filter(
                must=[
                    _org(org_id),
                    models.FieldCondition(key="source_id", match=models.MatchValue(value=str(removed))),
                ]
            )
            assert (await qdrant.count("chunks", count_filter=gone, exact=True)).count == 0

            # A file left behind (the model server was down while it was read) is indexed by the keeper.
            behind = sources["physics-light-krutidev.pdf"].id
            async with owner.begin() as conn:
                await conn.execute(
                    t_chunks.update().where(t_chunks.c.source_id == behind).values(indexed_at=None)
                )
                await conn.execute(
                    text("update sources set updated_at = now() - interval '10 minutes' where id = :s"),
                    {"s": behind},
                )
            keeper = IndexKeeper(
                activities.outbox, activities.waiting, activities.embedder, client, demo.task_queue
            )
            # Or the dev workers' keeper got there first: the workflow id is the file's.
            await keeper.catch_up()
            result = await client.get_workflow_handle(f"IndexSource:{behind}").result()
            assert result["indexedChunks"] > 0
    finally:
        await qdrant.close()
