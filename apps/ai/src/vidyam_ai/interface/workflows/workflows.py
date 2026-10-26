"""Workflows: durable orchestration only. Temporal replays this code after a crash, so it must be
deterministic; anything that touches the outside world belongs in an activity."""

from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError, ApplicationError

with workflow.unsafe.imports_passed_through():
    from vidyam_ai.generated.contracts import (
        AiTaskQueue,
        IngestSourceInput,
        IngestSourceResult,
        PingInput,
        WorkflowType,
    )
    from vidyam_ai.interface.workflows.activities import Activities, IngestionActivities, parse


def _queue(kind: AiTaskQueue) -> str:
    """A sibling task queue of the one this workflow runs on (tests run the whole set under a prefix)."""
    return workflow.info().task_queue.removesuffix(AiTaskQueue.ai.value) + kind.value


@workflow.defn(name=WorkflowType.ping)
class PingWorkflow:
    @workflow.run
    async def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        parse(PingInput, payload)  # fail fast, before any activity runs
        return await workflow.execute_activity_method(
            Activities.ping, payload, start_to_close_timeout=timedelta(seconds=30)
        )


@workflow.defn(name=WorkflowType.ingest_source)
class IngestSourceWorkflow:
    """Read one uploaded file into pages of clean Unicode, then chunk the usable text (ADR 0014)."""

    @workflow.run
    async def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        request = parse(IngestSourceInput, payload)
        try:
            pages: dict[str, int] = await workflow.execute_activity_method(
                IngestionActivities.extract_source,
                payload,
                task_queue=_queue(AiTaskQueue.ai_cpu),
                start_to_close_timeout=timedelta(hours=2),  # a 1,000-page book
                heartbeat_timeout=timedelta(minutes=2),
                retry_policy=RetryPolicy(maximum_attempts=3),
            )
            chunks = await workflow.execute_activity_method(
                IngestionActivities.chunk_source,
                payload,
                start_to_close_timeout=timedelta(minutes=10),
                retry_policy=RetryPolicy(maximum_attempts=5),
            )
        except ActivityError as error:
            reason = str(error.cause or error)
            await workflow.execute_activity_method(
                IngestionActivities.mark_source_failed,
                args=[payload, reason],
                start_to_close_timeout=timedelta(minutes=1),
            )
            raise ApplicationError(f"ingestion failed: {reason}", type="IngestionFailed") from error
        result = IngestSourceResult(sourceId=request.source_id, chunks=chunks, **pages)
        return result.model_dump(mode="json", by_alias=True)


WORKFLOWS = [PingWorkflow, IngestSourceWorkflow]
