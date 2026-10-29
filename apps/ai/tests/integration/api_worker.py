"""The API's Temporal worker (ADR 0017) as a child process on a queue of its own, for tests that run Python
workflows committing through it. Needs the API built (`pnpm --filter @vidyam/api build`); a running
`pnpm dev` doesn't interfere, since its worker polls the plain `api` queue."""

import asyncio
import os
import signal
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]


async def _until_ready(output: asyncio.StreamReader, line: str) -> None:
    """Temporal's own log lines come first; the script prints `line` once it polls."""
    while (read := await output.readline()) and read.decode().strip() != line:
        pass
    assert read, "the API worker stopped before it was ready"


@asynccontextmanager
async def api_worker(queue: str) -> AsyncGenerator[None]:
    process = await asyncio.create_subprocess_exec(
        *("pnpm", "--silent", "--filter", "@vidyam/api", "exec", "tsx", "scripts/api-worker.ts", queue),
        cwd=REPO,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,  # so the whole pnpm → node tree can be stopped
    )
    try:
        assert process.stdout
        await asyncio.wait_for(_until_ready(process.stdout, f"ready {queue}"), timeout=90)
        yield
    finally:
        if process.returncode is None:
            os.killpg(process.pid, signal.SIGTERM)
            await process.wait()
