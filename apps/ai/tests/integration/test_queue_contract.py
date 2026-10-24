"""Cross-language queue contract (ADR 0005): a Node producer creates a BullMQ flow; the Python worker must
consume it, honour parent/child ordering, and fail a bad payload permanently."""

import asyncio
import json
import os
from pathlib import Path
from uuid import uuid4

from bullmq import Job, Queue
from vidyam_ai.config import get_settings
from vidyam_ai.infrastructure.queue.runner import CpuPool, JobContext, QueueRunner
from vidyam_ai.interface.workers.handlers import HANDLERS

REPO = Path(__file__).resolve().parents[4]
QUEUE = "llm-live"


async def _wait_for(queue: Queue, job_id: str, state: str, within_s: float = 20) -> Job:
    deadline = asyncio.get_running_loop().time() + within_s
    while asyncio.get_running_loop().time() < deadline:
        if await queue.getJobState(job_id) == state:
            job = await Job.fromId(queue, job_id)
            assert job is not None
            return job
        await asyncio.sleep(0.2)
    raise AssertionError(f"job {job_id} never reached state {state!r}")


async def test_node_produced_flow_is_processed_by_the_python_worker() -> None:
    settings = get_settings()
    prefix = f"vidyam-test-{uuid4().hex[:8]}"  # isolated keys; never touches real queues
    cpu = CpuPool(processes=1)
    stop = asyncio.Event()
    runner = QueueRunner(
        connection=settings.queue_redis_url,
        queues=[QUEUE],
        handlers=HANDLERS,
        context=JobContext(cpu=cpu),
        prefix=prefix,
    )
    worker = asyncio.create_task(runner.run(stop))
    queue = Queue(QUEUE, {"connection": settings.queue_redis_url, "prefix": prefix})
    try:
        producer = await asyncio.create_subprocess_exec(
            *("pnpm", "--silent", "--filter", "@vidyam/api", "exec", "tsx"),
            *("scripts/queue-contract-producer.ts", prefix, QUEUE),
            cwd=REPO,
            env={**os.environ, "VIDYAM_QUEUE_REDIS_URL": settings.queue_redis_url},
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await producer.communicate()
        assert producer.returncode == 0, stderr.decode()
        ids = json.loads(stdout.decode().strip().splitlines()[-1])

        children = [await _wait_for(queue, child, "completed") for child in ids["children"]]
        parent = await _wait_for(queue, ids["parent"], "completed")
        assert parent.returnvalue == {"echo": "parent", "orgId": ids["orgId"]}
        assert sorted(c.returnvalue["echo"] for c in children) == ["child-1", "child-2"]
        assert all(c.finishedOn <= parent.processedOn for c in children), "parent ran before its children"

        bad = await _wait_for(queue, ids["bad"], "failed")
        assert "invalid ping payload" in bad.failedReason
        assert bad.attemptsMade == 1, "an unrecoverable payload must not be retried"
    finally:
        stop.set()
        await worker
        await queue.obliterate(force=True)
        await queue.close()
        cpu.close()
