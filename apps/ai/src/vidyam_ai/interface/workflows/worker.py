"""`vidyam-ai worker`: polls Vidyam's task queues and runs workflows and activities (ADR 0013)."""

import asyncio
import logging
import signal
from collections.abc import AsyncGenerator
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass

from temporalio.client import Client
from temporalio.worker import Worker

from vidyam_ai.application.ingestion import ChunkSource, ExtractSource
from vidyam_ai.config import Settings, get_settings
from vidyam_ai.domain.documents import PageReading
from vidyam_ai.generated.contracts import AiTaskQueue
from vidyam_ai.infrastructure.db.sources import SqlSources
from vidyam_ai.infrastructure.extraction import extract
from vidyam_ai.infrastructure.resources import Resources
from vidyam_ai.infrastructure.s3.files import S3Files
from vidyam_ai.infrastructure.temporal.client import connect, wait_for_namespace
from vidyam_ai.infrastructure.temporal.cpu import CpuPool
from vidyam_ai.interface.workflows.activities import Activities, IngestionActivities
from vidyam_ai.interface.workflows.workflows import WORKFLOWS

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class AllActivities:
    core: Activities
    ingestion: IngestionActivities
    cpu_slots: int


@asynccontextmanager
async def open_activities(settings: Settings) -> AsyncGenerator[AllActivities]:
    """Activities wired to real Postgres, S3 and a process pool for CPU-heavy reading."""
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
            cpu_slots=settings.worker_cpu_processes,
        )
    finally:
        cpu.close()
        await resources.close()


def create_workers(client: Client, activities: AllActivities, *, task_queue_prefix: str = "") -> list[Worker]:
    """One worker per task queue: `ai` runs workflows and light steps; `ai-cpu` runs as many file readings
    at once as there are CPU processes. `ai-llm` gets its worker when the first model calls arrive."""

    def queue(kind: AiTaskQueue) -> str:
        return task_queue_prefix + kind.value

    core, ingestion = activities.core, activities.ingestion
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
    ]


async def run_workers(settings: Settings) -> None:
    client = await connect(settings)
    await wait_for_namespace(client)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    async with open_activities(settings) as activities, AsyncExitStack() as running:
        for worker in create_workers(client, activities):
            await running.enter_async_context(worker)
        polled = ", ".join(q.value for q in (AiTaskQueue.ai, AiTaskQueue.ai_cpu))
        log.info("workers polling namespace %r, task queues %s", client.namespace, polled)
        await stop.wait()
    log.info("workers stopped")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    asyncio.run(run_workers(get_settings()))


if __name__ == "__main__":
    main()
