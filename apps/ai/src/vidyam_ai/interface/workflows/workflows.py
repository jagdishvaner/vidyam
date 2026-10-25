"""Workflows: durable orchestration only. Temporal replays this code after a crash, so it must be
deterministic; anything that touches the outside world belongs in an activity."""

from datetime import timedelta
from typing import Any

from temporalio import workflow

with workflow.unsafe.imports_passed_through():
    from vidyam_ai.generated.contracts import PingInput, WorkflowType
    from vidyam_ai.interface.workflows.activities import Activities, parse


@workflow.defn(name=WorkflowType.ping)
class PingWorkflow:
    @workflow.run
    async def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        parse(PingInput, payload)  # fail fast, before any activity runs
        return await workflow.execute_activity_method(
            Activities.ping, payload, start_to_close_timeout=timedelta(seconds=30)
        )


WORKFLOWS = [PingWorkflow]
