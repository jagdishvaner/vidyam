"""Cross-language workflow contract (ADR 0013): a TypeScript client starts workflows by name and the Python
worker runs them. Results keep the contract's camelCase shape, and input that breaks the contract fails the
workflow at once instead of retrying."""

import asyncio
import json
import os
from contextlib import AsyncExitStack
from pathlib import Path
from uuid import uuid4

from vidyam_ai.config import get_settings
from vidyam_ai.infrastructure.temporal.client import connect, wait_for_namespace
from vidyam_ai.infrastructure.temporal.cpu import CpuPool
from vidyam_ai.interface.workflows.activities import Activities
from vidyam_ai.interface.workflows.worker import create_workers

REPO = Path(__file__).resolve().parents[4]


async def test_typescript_started_workflows_run_on_the_python_worker() -> None:
    settings = get_settings()
    client = await connect(settings)
    await wait_for_namespace(client)
    task_queue = f"contract-test-{uuid4().hex[:8]}"  # isolated from any worker started by `pnpm dev`
    cpu = CpuPool(processes=1)
    try:
        async with AsyncExitStack() as running:
            for worker in create_workers(client, Activities(cpu=cpu), task_queue=task_queue):
                await running.enter_async_context(worker)
            starter = await asyncio.create_subprocess_exec(
                *("pnpm", "--silent", "--filter", "@vidyam/api", "exec", "tsx"),
                *("scripts/workflow-contract-client.ts", task_queue),
                cwd=REPO,
                env={
                    **os.environ,
                    "VIDYAM_TEMPORAL_ADDRESS": settings.temporal_address,
                    "VIDYAM_TEMPORAL_NAMESPACE": settings.temporal_namespace,
                },
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(starter.communicate(), timeout=90)
    finally:
        cpu.close()

    assert starter.returncode == 0, stderr.decode()
    outcome = json.loads(stdout.decode().strip().splitlines()[-1])
    assert outcome["result"] == {"echo": "hello from node", "orgId": outcome["orgId"]}
    assert outcome["bad"]["type"] == "InvalidPayload"
    assert outcome["bad"]["nonRetryable"] is True
    assert "invalid PingInput" in outcome["bad"]["message"]
