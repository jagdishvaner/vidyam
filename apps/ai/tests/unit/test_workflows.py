import os
from uuid import uuid4

import pytest
from temporalio.exceptions import ApplicationError
from temporalio.testing import ActivityEnvironment
from vidyam_ai.infrastructure.temporal.cpu import CpuPool
from vidyam_ai.interface.workflows.activities import Activities


def _pid() -> int:
    return os.getpid()


async def test_cpu_pool_runs_work_in_another_process() -> None:
    pool = CpuPool(processes=1)
    try:
        assert await pool.run(_pid) != os.getpid()
    finally:
        pool.close()


async def test_ping_answers_in_the_contract_shape() -> None:
    org = str(uuid4())
    payload = {"v": 1, "orgId": org, "requestedBy": None, "message": "hi"}
    result = await ActivityEnvironment().run(Activities(cpu=None).ping, payload)  # type: ignore[arg-type]
    assert result == {"echo": "hi", "orgId": org}


async def test_a_payload_that_breaks_the_contract_fails_without_retries() -> None:
    with pytest.raises(ApplicationError, match="invalid PingInput") as failure:
        await ActivityEnvironment().run(Activities(cpu=None).ping, {"v": 2})  # type: ignore[arg-type]
    assert failure.value.non_retryable
    assert failure.value.type == "InvalidPayload"
