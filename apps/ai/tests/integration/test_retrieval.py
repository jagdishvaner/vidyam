"""Retrieval end to end (plan v3 §7 step 3, step 20) on the demo pack, with the real Qwen3 model servers
(`pnpm models:up`; skipped without them).

Hindi, English and Hinglish queries find their passage after reranking; a chapter scope keeps to that
chapter; the Hindi and English editions of one book give one copy, in the language asked for; picks bring
their neighbours; a repeated query skips the models (cache); and with the embedding server down, search still
works by keywords. Runs in a throwaway organization, and removes everything it created."""

import json
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
import pytest
from redis.asyncio import Redis
from sqlalchemy import text
from vidyam_ai.application.retrieval import RetrievalRequest, Retrieve
from vidyam_ai.config import get_settings
from vidyam_ai.domain.embeddings import EmbeddingVersion
from vidyam_ai.domain.retrieval import Scope, Tuning
from vidyam_ai.infrastructure.cache import CachedEmbedder, CachedReranker, ValkeyCache
from vidyam_ai.infrastructure.models import create_embedder, create_reranker
from vidyam_ai.infrastructure.models.qwen import HttpEmbedder
from vidyam_ai.infrastructure.qdrant.search import QdrantPassageIndex
from vidyam_ai.infrastructure.resources import create_qdrant

from tests.integration.demo import demo_org
from tests.integration.test_manifest_ingestion import PACK, embedder_ready

QUERIES = {item["id"]: item for item in json.loads((PACK / "eval" / "retrieval.json").read_text())}


def _flat(text: str) -> str:
    return "".join(text.split())


def answers(item: dict[str, Any], context: str) -> bool:
    return any(_flat(expected["phrase"])[:40] in _flat(context) for expected in item["expect"])


async def test_retrieval_finds_answers_across_languages_editions_and_scopes(tmp_path: Path) -> None:
    settings = get_settings()
    if not await embedder_ready(settings):
        pytest.skip("the model servers aren't running (pnpm models:up)")
    qdrant = create_qdrant(settings)
    redis = Redis.from_url(settings.cache_redis_url)
    cache_prefix = f"test:{uuid4().hex}:"
    try:
        async with httpx.AsyncClient() as http, demo_org(tmp_path, "retrieval-test") as demo:
            # As `create_retrieve` wires it, with a cache of its own: scores from earlier runs would hide the
            # first, slow one.
            cache = ValkeyCache(redis, prefix=cache_prefix)
            retrieve = Retrieve(
                QdrantPassageIndex(qdrant),
                CachedEmbedder(create_embedder(settings, http), cache),
                CachedReranker(create_reranker(settings, http), cache, settings.rerank_model),
                Tuning(rerank=settings.rerank_candidates, rerank_tokens=settings.rerank_tokens),
            )
            sources = {
                row.id: Path(row.filename).name
                for row in await _rows(demo.owner, "select id, filename from sources where org_id = :o", demo)
            }

            # Hindi, English (the answer is in Hindi notes) and Hinglish.
            for query_id in ("motion-force-01", "motion-force-03", "motion-force-02"):
                item = QUERIES[query_id]
                found = await retrieve.execute(RetrievalRequest(demo.org_id, item["query"]))
                assert found.dense and found.reranked and not found.notes, query_id
                assert answers(item, found.hits[0].context), (query_id, found.hits[0].passage.text)
                assert found.hits[0].relevance is not None and found.hits[0].relevance > 0.5
            assert any(hit.before or hit.after for hit in found.hits)  # neighbours from the same section

            # The same query again: query vector and reranker scores come from the cache.
            again = await retrieve.execute(RetrievalRequest(demo.org_id, item["query"]))
            assert [h.passage.chunk_id for h in again.hits] == [h.passage.chunk_id for h in found.hits]
            assert again.timings_ms["rerank"] < 1000 < found.timings_ms["rerank"]

            # One copy of a passage that both editions have, in the language asked for.
            horsepower = QUERIES["work-energy-light-06"]["query"]
            for language, edition, other in (
                ("hi", "physics-work-energy-hi.pdf", "physics-work-energy-en.pdf"),
                ("en", "physics-work-energy-en.pdf", "physics-work-energy-hi.pdf"),
            ):
                found = await retrieve.execute(RetrievalRequest(demo.org_id, horsepower, language=language))
                files = [sources[hit.passage.source_id] for hit in found.hits]
                assert files[0] == edition and "746" in found.hits[0].passage.text, (language, files)
                # the other edition's copy of the passage is left out
                copies = [
                    h for h in found.hits if sources[h.passage.source_id] == other and "746" in h.passage.text
                ]
                assert not copies, (language, [h.passage.text[:80] for h in copies])

            # A chapter scope keeps to the chapter (and its topics).
            [chapter] = [
                row.id
                for row in await _rows(
                    demo.owner,
                    "select id from taxonomy_nodes where org_id = :o and code = 'work_and_energy'",
                    demo,
                )
            ]
            scoped = await retrieve.execute(
                RetrievalRequest(demo.org_id, "energy", scope=Scope(node_ids=(chapter,)), rerank=False)
            )
            assert scoped.hits and all(
                sources[hit.passage.source_id].startswith("physics-work-energy") for hit in scoped.hits
            )

            # With the embedding server down, keywords still find Hindi and Hinglish.
            offline = Retrieve(
                QdrantPassageIndex(qdrant),
                HttpEmbedder(http, "http://127.0.0.1:9", EmbeddingVersion("down", 3)),
                create_reranker(settings, http),
                Tuning(),
            )
            for query in ("विस्थापन", "visthapan"):
                keywords = await offline.execute(RetrievalRequest(demo.org_id, query, rerank=False))
                assert not keywords.dense and keywords.notes[0].startswith("searched by keywords only")
                assert keywords.hits and "विस्थापन" in keywords.hits[0].passage.text, query
    finally:
        await qdrant.close()
        async for key in redis.scan_iter(f"{cache_prefix}*"):
            await redis.delete(key)
        await redis.aclose()


async def _rows(owner: Any, sql: str, demo: Any) -> list[Any]:
    async with owner.connect() as conn:
        return list(await conn.execute(text(sql), {"o": demo.org_id}))
