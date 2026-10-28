"""`vidyam-ai <command>`: run the internal API, the workers, or one-off operations."""

import argparse
import asyncio
import subprocess
import sys
from uuid import UUID

import uvicorn
from sqlalchemy import text

from vidyam_ai.application.retrieval import RetrievalRequest
from vidyam_ai.config import get_settings
from vidyam_ai.domain.retrieval import Scope
from vidyam_ai.infrastructure.db.embeddings import register_version
from vidyam_ai.infrastructure.db.engine import create_engine
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


async def _search(args: argparse.Namespace) -> int:
    """Searches one center's material as the chat and paper generation will, and prints what was found."""
    settings = get_settings()
    resources = await Resources.open(settings)
    try:
        async with resources.engine.connect() as conn:
            org_id = (
                await conn.execute(text("select id from organizations where slug = :s"), {"s": args.org})
            ).scalar_one_or_none()
        if org_id is None:
            print(f"no organization with the slug {args.org!r}", file=sys.stderr)
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
    args = parser.parse_args()
    if args.command == "serve":
        serve()
    elif args.command == "worker":
        run_workers()
    elif args.command == "dev":
        dev()
    elif args.command == "search":
        sys.exit(asyncio.run(_search(args)))
    else:
        asyncio.run(_bootstrap_qdrant())


if __name__ == "__main__":
    main()
