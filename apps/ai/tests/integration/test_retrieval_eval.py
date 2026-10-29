"""The retrieval eval (plan v3 step 21, §10) on the demo pack: its 50 teacher queries with known answers and
6 questions it doesn't answer, through retrieval as the chat sends them, with whichever Qwen3 models are
configured (the 4B pair locally, the 0.6B pair in CI).

`pnpm eval:retrieval` runs it (left out of `pnpm test:integration`: the 4B reranker takes about 15 minutes on
the Mac). The report goes to apps/ai/reports/retrieval-eval.md. Thresholds default to the plan's target, and
can be set for the small models: VIDYAM_EVAL_MIN_RECALL, VIDYAM_EVAL_MIN_FOUND, VIDYAM_EVAL_MIN_REJECTED."""

import json
import os
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from redis.asyncio import Redis
from vidyam_ai.application.evaluation import EvaluateRetrieval
from vidyam_ai.config import REPO_ROOT, get_settings
from vidyam_ai.domain.evaluation import TARGET_RECALL_AT_20, Outcome, parse_queries, report, summarize
from vidyam_ai.infrastructure.db.engine import create_engine
from vidyam_ai.infrastructure.db.evaluation import SqlEvalCorpus
from vidyam_ai.infrastructure.resources import create_qdrant
from vidyam_ai.infrastructure.retrieval import create_retrieve

from tests.integration.demo import demo_org
from tests.integration.test_manifest_ingestion import PACK, embedder_ready

pytestmark = pytest.mark.eval

MIN_RECALL = float(os.environ.get("VIDYAM_EVAL_MIN_RECALL", TARGET_RECALL_AT_20))
MIN_FOUND = float(os.environ.get("VIDYAM_EVAL_MIN_FOUND", "0.9"))  # the answer among the passages returned
MIN_REJECTED = float(os.environ.get("VIDYAM_EVAL_MIN_REJECTED", "0.8"))  # unanswerable ones left empty
REPORT = Path(
    os.environ.get("VIDYAM_EVAL_REPORT", REPO_ROOT / "apps" / "ai" / "reports" / "retrieval-eval.md")
)


def _progress(outcome: Outcome) -> None:
    ranks = f"candidate {outcome.candidate_rank} pick {outcome.pick_rank}"
    print(f"  {outcome.query.id:<26} {outcome.status:<12} {ranks}")


def _write(report_text: str) -> None:
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(report_text)
    print(f"\n{report_text}\nreport: {REPORT}")


async def test_retrieval_meets_its_targets_on_the_demo_pack(tmp_path: Path) -> None:
    settings = get_settings()
    if not await embedder_ready(settings):
        pytest.skip("the model servers aren't running (pnpm models:up)")
    queries = [
        query
        for name in ("retrieval.json", "unanswerable.json")
        for query in parse_queries(json.loads((PACK / "eval" / name).read_text()))
    ]
    qdrant = create_qdrant(settings)
    redis = Redis.from_url(settings.cache_redis_url)
    engine = create_engine(settings.async_database_url)
    cache_prefix = f"eval:{uuid4().hex}:"  # a cold cache, so the report times the models for real
    try:
        async with httpx.AsyncClient() as http, demo_org(tmp_path, "retrieval-eval") as demo:
            retrieve = create_retrieve(settings, qdrant, http, redis, cache_prefix=cache_prefix)
            evaluate = EvaluateRetrieval(retrieve, SqlEvalCorpus(engine))
            outcomes = await evaluate.execute(demo.org_id, queries, progress=_progress)
    finally:
        await qdrant.close()
        async for key in redis.scan_iter(f"{cache_prefix}*"):
            await redis.delete(key)
        await redis.aclose()
        await engine.dispose()

    summary = summarize(outcomes, reranked=True)
    models = f"{settings.embedding_model} + {settings.rerank_model}"
    text = report(summary, outcomes, title=f"Retrieval eval: demo pack ({models})")
    _write(text)

    overall = summary.overall
    assert overall.queries >= 45  # all but the scanned file's queries, until OCR reads it
    assert overall.recall_at[20] >= MIN_RECALL, text
    assert overall.found >= MIN_FOUND, text
    assert summary.rejected >= MIN_REJECTED * summary.unanswerable, text
