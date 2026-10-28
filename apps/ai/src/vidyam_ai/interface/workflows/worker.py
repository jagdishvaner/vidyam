"""`vidyam-ai worker`: polls Vidyam's task queues and runs workflows and activities (ADR 0013)."""

import asyncio
import logging
import signal
from collections.abc import AsyncGenerator, Mapping
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass

from temporalio.client import Client
from temporalio.worker import Worker

from vidyam_ai.application.ingestion import ChunkSource, ExtractSource
from vidyam_ai.application.llm_gateway import BatchHandler
from vidyam_ai.application.providers import provider_status
from vidyam_ai.config import Settings, get_settings
from vidyam_ai.domain.documents import PageReading
from vidyam_ai.generated.contracts import AiTaskQueue
from vidyam_ai.infrastructure.db.sources import SqlSources
from vidyam_ai.infrastructure.extraction import extract
from vidyam_ai.infrastructure.llm import create_llm_gateway
from vidyam_ai.infrastructure.resources import Resources
from vidyam_ai.infrastructure.s3.files import S3Files
from vidyam_ai.infrastructure.temporal.client import connect, wait_for_namespace
from vidyam_ai.infrastructure.temporal.cpu import CpuPool
from vidyam_ai.interface.workflows.activities import Activities, IngestionActivities, LlmActivities
from vidyam_ai.interface.workflows.workflows import WORKFLOWS

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class AllActivities:
    core: Activities
    ingestion: IngestionActivities
    llm: LlmActivities
    cpu_slots: int


# What stores each kind of batch's results, by task. OCR, tagging and segmentation add theirs (step 16).
BATCH_HANDLERS: Mapping[str, BatchHandler] = {}


@asynccontextmanager
async def open_activities(
    settings: Settings, *, batch_handlers: Mapping[str, BatchHandler] = BATCH_HANDLERS
) -> AsyncGenerator[AllActivities]:
    """Activities wired to real Postgres, S3, the LLM gateway and a process pool for CPU-heavy reading."""
    resources = await Resources.open(settings)
    cpu = CpuPool(settings.worker_cpu_processes)

    async def read(path: str, mime_type: str) -> list[PageReading]:
        return await cpu.run(extract, path, mime_type)

    sources = SqlSources(resources.engine)
    files = S3Files(resources.s3, settings.bucket("raw"))
    try:
        yield AllActivities(
            core=Activities(cpu=cpu),
            ingestion=IngestionActivities(ExtractSource(sources, files, read), ChunkSource(sources), sources),
            llm=LlmActivities(create_llm_gateway(settings, resources.engine), batch_handlers),
            cpu_slots=settings.worker_cpu_processes,
        )
    finally:
        cpu.close()
        await resources.close()


def create_workers(client: Client, activities: AllActivities, *, task_queue_prefix: str = "") -> list[Worker]:
    """One worker per task queue: `ai` runs workflows and light steps; `ai-cpu` runs as many file readings
    at once as there are CPU processes; `ai-llm` runs the steps that wait on model providers."""

    def queue(kind: AiTaskQueue) -> str:
        return task_queue_prefix + kind.value

    core, ingestion, llm = activities.core, activities.ingestion, activities.llm
    return [
        Worker(
            client,
            task_queue=queue(AiTaskQueue.ai),
            workflows=WORKFLOWS,
            activities=[core.ping, ingestion.chunk_source, ingestion.mark_source_failed],
        ),
        Worker(
            client,
            task_queue=queue(AiTaskQueue.ai_cpu),
            activities=[ingestion.extract_source],
            max_concurrent_activities=activities.cpu_slots,
        ),
        Worker(
            client,
            task_queue=queue(AiTaskQueue.ai_llm),
            activities=[llm.batch_ended, llm.collect_batch],
        ),
    ]


async def run_workers(settings: Settings) -> None:
    if not any(p.configured for p in provider_status(settings).providers):
        outcome = "model calls will fail" if settings.is_production else "the stub model answers every call"
        log.log(
            logging.ERROR if settings.is_production else logging.WARNING,
            "no LLM provider key is set: %s",
            outcome,
        )
    client = await connect(settings)
    await wait_for_namespace(client)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    async with open_activities(settings) as activities, AsyncExitStack() as running:
        for worker in create_workers(client, activities):
            await running.enter_async_context(worker)
        polled = ", ".join(q.value for q in (AiTaskQueue.ai, AiTaskQueue.ai_cpu, AiTaskQueue.ai_llm))
        log.info("workers polling namespace %r, task queues %s", client.namespace, polled)
        await stop.wait()
    log.info("workers stopped")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    asyncio.run(run_workers(get_settings()))


if __name__ == "__main__":
    main()
