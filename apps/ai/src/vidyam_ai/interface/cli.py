"""`vidyam-ai <command>`: run the internal API, the workers, or one-off operations."""

import argparse
import asyncio
import json
import subprocess
import sys
from pathlib import Path
from uuid import UUID

import uvicorn
from sqlalchemy import text

from vidyam_ai.application.evaluation import EvaluateRetrieval
from vidyam_ai.application.retrieval import RetrievalRequest
from vidyam_ai.config import REPO_ROOT, get_settings
from vidyam_ai.domain.evaluation import EvalQuery, Outcome, parse_queries, report, summarize
from vidyam_ai.domain.retrieval import Scope
from vidyam_ai.infrastructure.db.embeddings import register_version
from vidyam_ai.infrastructure.db.engine import create_engine
from vidyam_ai.infrastructure.db.evaluation import SqlEvalCorpus
from vidyam_ai.infrastructure.db.syllabus import SqlSyllabus
from vidyam_ai.infrastructure.models import embedding_version
from vidyam_ai.infrastructure.qdrant.collections import EmbeddingProfile, bootstrap
from vidyam_ai.infrastructure.resources import Resources, create_qdrant
from vidyam_ai.infrastructure.retrieval import create_retrieve
from vidyam_ai.interface.workflows.worker import main as run_workers

APP = "vidyam_ai.interface.http.app:create_app"


def serve(reload: bool = False) -> None:
    settings = get_settings()
    uvicorn.run(APP, factory=True, host=settings.ai_host, port=settings.ai_port, reload=reload)


def dev() -> None:
    """API with auto-reload, plus workers restarted on code changes."""
    workers = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "watchfiles",
            "--filter",
            "python",
            "vidyam_ai.interface.workflows.worker.main",
            "src",
        ]
    )
    try:
        serve(reload=True)
    finally:
        workers.terminate()
        workers.wait()


async def _bootstrap_qdrant() -> None:
    """Qdrant collections for the configured embedding model, and that model as the active version."""
    settings = get_settings()
    client = create_qdrant(settings)
    engine = create_engine(settings.async_database_url)
    try:
        profile = EmbeddingProfile(settings.embedding_model, settings.embedding_dims)
        for line in await bootstrap(client, profile):
            print(f"qdrant: {line}")
        version = embedding_version(settings)
        await register_version(engine, version)
        print(f"embedding version: {version.id} is active")
    finally:
        await client.close()
        await engine.dispose()


async def _org_id(resources: Resources, slug: str) -> UUID | None:
    async with resources.engine.connect() as conn:
        org_id = (
            await conn.execute(text("select id from organizations where slug = :s"), {"s": slug})
        ).scalar_one_or_none()
    if org_id is None:
        print(f"no organization with the slug {slug!r}", file=sys.stderr)
    return org_id


async def _search(args: argparse.Namespace) -> int:
    """Searches one center's material as the chat and paper generation will, and prints what was found."""
    settings = get_settings()
    resources = await Resources.open(settings)
    try:
        org_id = await _org_id(resources, args.org)
        if org_id is None:
            return 2
        nodes = {node.path: node for node in await SqlSyllabus(resources.engine).nodes(org_id)}
        scope_nodes: list[UUID] = []
        for wanted in args.node:
            matches = [n for path, n in nodes.items() if path == wanted or path.endswith(f"/{wanted}")]
            if len(matches) != 1:
                print(
                    f"--node {wanted!r} matches {len(matches)} syllabus nodes; give its full path",
                    file=sys.stderr,
                )
                return 2
            scope_nodes.append(matches[0].id)
        retrieve = create_retrieve(settings, resources.qdrant, resources.http, resources.cache_redis)
        found = await retrieve.execute(
            RetrievalRequest(
                org_id=org_id,
                query=args.query,
                scope=Scope(node_ids=tuple(scope_nodes)),
                limit=args.limit,
                language=args.language,
                rerank=not args.no_rerank,
            )
        )
    finally:
        await resources.close()
    how = "meaning and keywords" if found.dense else "keywords only"
    ranked = "reranked" if found.reranked else "not reranked"
    timings = ", ".join(f"{stage} {ms:.0f} ms" for stage, ms in found.timings_ms.items())
    print(f"{found.candidates} candidates by {how}; {ranked}; {len(found.hits)} kept ({timings})")
    for note in found.notes:
        print(f"  note: {note}")
    if not found.hits:
        print("\nNothing in this center's material answers it.")
    for n, hit in enumerate(found.hits, 1):
        p = hit.passage
        score = f"{hit.relevance:.2f}" if hit.relevance is not None else "  - "
        page = f"p. {p.page_label or p.page_start}" if (p.page_label or p.page_start) else "no page"
        print(f"\n{n}. {score}  {p.title or p.source_id} · {page} · {p.heading_path or ''}")
        print(f"   {' '.join(p.text.split())[:240]}")
        if hit.before or hit.after:
            print(f"   (+{len(hit.before)} before, +{len(hit.after)} after from the same section)")
    return 0


DEMO_QUERIES = [
    REPO_ROOT / "fixtures" / "demo-pack" / "eval" / "retrieval.json",
    REPO_ROOT / "fixtures" / "demo-pack" / "eval" / "unanswerable.json",
]


def _progress(outcome: Outcome) -> None:
    where = {"waiting": "waiting for OCR", "unanswerable": f"{outcome.picks} picks"}.get(
        outcome.status, f"candidate {outcome.candidate_rank or '-'}, pick {outcome.pick_rank or '-'}"
    )
    print(f"  {outcome.query.id:<26} {outcome.query.lang:<9} {where}", flush=True)


async def _evaluate(org: str, queries: list[EvalQuery], *, rerank: bool) -> list[Outcome] | None:
    settings = get_settings()
    resources = await Resources.open(settings)
    try:
        org_id = await _org_id(resources, org)
        if org_id is None:
            return None
        retrieve = create_retrieve(settings, resources.qdrant, resources.http, resources.cache_redis)
        evaluate = EvaluateRetrieval(retrieve, SqlEvalCorpus(resources.engine))
        print(f"{len(queries)} queries against {org}", flush=True)
        return await evaluate.execute(org_id, queries, rerank=rerank, progress=_progress)
    finally:
        await resources.close()


def _eval_retrieval(args: argparse.Namespace) -> int:
    """The retrieval eval (step 21) against a center's library; exits 1 below the recall@20 target."""
    settings = get_settings()
    files = [Path(path) for path in args.queries] if args.queries else DEMO_QUERIES
    queries = [query for path in files for query in parse_queries(json.loads(path.read_text()))]
    outcomes = asyncio.run(_evaluate(args.org, queries, rerank=not args.no_rerank))
    if outcomes is None:
        return 2
    summary = summarize(outcomes, reranked=not args.no_rerank)
    models = f"{settings.embedding_model} + {settings.rerank_model}"
    text_report = report(summary, outcomes, title=f"Retrieval eval: {args.org} ({models})")
    print(f"\n{text_report}")
    if args.report:
        Path(args.report).write_text(text_report)
    return 0 if summary.meets_target else 1


def main() -> None:
    parser = argparse.ArgumentParser(prog="vidyam-ai")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("serve", "worker", "dev", "bootstrap"):
        commands.add_parser(name)
    search = commands.add_parser("search", help="search a center's material (Hindi, English or Hinglish)")
    search.add_argument("query")
    search.add_argument("--org", required=True, help="the center's slug")
    search.add_argument("--node", action="append", default=[], help="syllabus path or code (repeatable)")
    search.add_argument("--language", choices=["hi", "en"], help="the edition to prefer")
    search.add_argument("--limit", type=int, default=8)
    search.add_argument("--no-rerank", action="store_true", help="skip the reranker (much faster on a Mac)")
    evaluate = commands.add_parser("eval-retrieval", help="measure search on queries with known answers")
    evaluate.add_argument("--org", required=True, help="the center's slug")
    evaluate.add_argument("--queries", action="append", help="query files (default: the demo pack's)")
    evaluate.add_argument("--no-rerank", action="store_true", help="measure search without the reranker")
    evaluate.add_argument("--report", help="also write the Markdown report here")
    args = parser.parse_args()
    if args.command == "serve":
        serve()
    elif args.command == "worker":
        run_workers()
    elif args.command == "dev":
        dev()
    elif args.command == "search":
        sys.exit(asyncio.run(_search(args)))
    elif args.command == "eval-retrieval":
        sys.exit(_eval_retrieval(args))
    else:
        asyncio.run(_bootstrap_qdrant())


if __name__ == "__main__":
    main()
