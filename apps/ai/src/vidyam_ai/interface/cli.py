"""`vidyam-ai <command>`: run the internal API, the workers, or one-off operations."""

import argparse
import asyncio
import subprocess
import sys

import uvicorn

from vidyam_ai.config import get_settings
from vidyam_ai.infrastructure.qdrant.collections import EmbeddingProfile, bootstrap
from vidyam_ai.infrastructure.resources import create_qdrant
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
    settings = get_settings()
    client = create_qdrant(settings)
    try:
        profile = EmbeddingProfile(settings.embedding_model, settings.embedding_dims)
        for line in await bootstrap(client, profile):
            print(f"qdrant: {line}")
    finally:
        await client.close()


def main() -> None:
    parser = argparse.ArgumentParser(prog="vidyam-ai")
    parser.add_argument("command", choices=["serve", "worker", "dev", "bootstrap"])
    command = parser.parse_args().command
    if command == "serve":
        serve()
    elif command == "worker":
        run_workers()
    elif command == "dev":
        dev()
    else:
        asyncio.run(_bootstrap_qdrant())


if __name__ == "__main__":
    main()
