import os
from types import SimpleNamespace
from uuid import uuid4

import pytest
from bullmq import UnrecoverableError
from vidyam_ai.infrastructure.queue.runner import CpuPool, JobContext
from vidyam_ai.interface.workers.handlers import ping


def _pid() -> int:
    return os.getpid()


async def test_cpu_pool_runs_work_in_another_process() -> None:
    pool = CpuPool(processes=1)
    try:
        assert await pool.run(_pid) != os.getpid()
    finally:
        pool.close()


async def test_ping_returns_the_message_and_org() -> None:
    org = uuid4()
    job = SimpleNamespace(
        data={
            "v": 1,
            "kind": "ping",
            "orgId": str(org),
            "requestedBy": None,
            "traceparent": None,
            "message": "hi",
        }
    )
    assert await ping(job, JobContext(cpu=None)) == {"echo": "hi", "orgId": str(org)}  # type: ignore[arg-type]


async def test_ping_rejects_an_unknown_payload_version_without_retries() -> None:
    job = SimpleNamespace(data={"v": 2, "kind": "ping"})
    with pytest.raises(UnrecoverableError, match="invalid ping payload"):
        await ping(job, JobContext(cpu=None))  # type: ignore[arg-type]
