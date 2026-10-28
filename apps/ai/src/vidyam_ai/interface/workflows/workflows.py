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
        LlmBatchInput,
        PingInput,
        Stages,
        WorkflowType,
    )
    from vidyam_ai.interface.workflows.activities import Activities, IngestionActivities, LlmActivities, parse


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
    """Read one uploaded file into pages of clean Unicode with page images; find its sections and chunk the
    usable text; tag the chunks with the syllabus by rules (ADR 0014, plan v3 §5). With `stages: structure`
    the stored pages are kept and only sections, chunks and tags are worked out again."""

    @workflow.run
    async def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        request = parse(IngestSourceInput, payload)
        try:
            if request.stages == Stages.all:
                await workflow.execute_activity_method(
                    IngestionActivities.extract_source,
                    payload,
                    task_queue=_queue(AiTaskQueue.ai_cpu),
                    start_to_close_timeout=timedelta(hours=2),  # a 1,000-page book
                    heartbeat_timeout=timedelta(minutes=2),
                    retry_policy=RetryPolicy(maximum_attempts=3),
                )
            structure: dict[str, int] = await workflow.execute_activity_method(
                IngestionActivities.structure_source,
                payload,
                start_to_close_timeout=timedelta(minutes=10),
                retry_policy=RetryPolicy(maximum_attempts=5),
            )
            tagged = await workflow.execute_activity_method(
                IngestionActivities.tag_source,
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
        result = IngestSourceResult(sourceId=request.source_id, taggedChunks=tagged, **structure)
        return result.model_dump(mode="json", by_alias=True)


@workflow.defn(name=WorkflowType.llm_batch)
class LlmBatchWorkflow:
    """Waits on durable timers for a provider batch to finish (minutes, at most 24 hours), then collects it.
    Checks start a minute apart and slow to every ten minutes."""

    @workflow.run
    async def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        parse(LlmBatchInput, payload)
        llm = _queue(AiTaskQueue.ai_llm)
        wait = timedelta(minutes=1)
        while not await workflow.execute_activity_method(
            LlmActivities.batch_ended,
            payload,
            task_queue=llm,
            start_to_close_timeout=timedelta(minutes=2),
            retry_policy=RetryPolicy(maximum_interval=timedelta(minutes=5)),
        ):
            await workflow.sleep(wait)
            wait = min(wait * 2, timedelta(minutes=10))
        return await workflow.execute_activity_method(
            LlmActivities.collect_batch,
            payload,
            task_queue=llm,
            start_to_close_timeout=timedelta(minutes=30),
            retry_policy=RetryPolicy(maximum_attempts=10, maximum_interval=timedelta(minutes=5)),
        )


WORKFLOWS = [PingWorkflow, IngestSourceWorkflow, LlmBatchWorkflow]
