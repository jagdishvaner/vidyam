"""`vidyam-ai worker`: polls Vidyam's task queues and runs workflows and activities (ADR 0013)."""

import asyncio
import logging
import signal
from collections.abc import AsyncGenerator, Mapping
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass

from temporalio.client import Client
from temporalio.worker import Worker

from vidyam_ai.application.backlogs import Backlogs
from vidyam_ai.application.embedding import EmbedSource
from vidyam_ai.application.ingestion import ExtractSource, ReadAnswerKey, StructureSource, TagSource
from vidyam_ai.application.llm_gateway import BatchHandler
from vidyam_ai.application.providers import provider_status
from vidyam_ai.config import Settings, get_settings
from vidyam_ai.domain.documents import PageReading
from vidyam_ai.generated.contracts import AiTaskQueue
from vidyam_ai.infrastructure.db.backlogs import SqlBacklogStore
from vidyam_ai.infrastructure.db.embeddings import SqlEmbeddingStore
from vidyam_ai.infrastructure.db.sources import SqlSources
from vidyam_ai.infrastructure.db.syllabus import SqlSyllabus
from vidyam_ai.infrastructure.extraction import extract, render_pages
from vidyam_ai.infrastructure.llm import create_llm_gateway
from vidyam_ai.infrastructure.models import create_embedder
from vidyam_ai.infrastructure.resources import Resources
from vidyam_ai.infrastructure.s3.files import S3Files
from vidyam_ai.infrastructure.s3.page_images import S3PageImages
from vidyam_ai.infrastructure.s3.vectors import S3VectorFiles
from vidyam_ai.infrastructure.temporal.client import connect, wait_for_namespace
from vidyam_ai.infrastructure.temporal.cpu import CpuPool
from vidyam_ai.interface.workflows.activities import (
    Activities,
    BacklogActivities,
    IngestionActivities,
    LlmActivities,
)
from vidyam_ai.interface.workflows.workflows import WORKFLOWS

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class AllActivities:
    core: Activities
    ingestion: IngestionActivities
    llm: LlmActivities
    backlog: BacklogActivities
    cpu_slots: int


@asynccontextmanager
async def open_activities(
    settings: Settings, *, batch_handlers: Mapping[str, BatchHandler] | None = None
) -> AsyncGenerator[AllActivities]:
    """Activities wired to real Postgres, S3, the LLM gateway and a process pool for CPU-heavy reading.
    `batch_handlers`: more handlers for batch results, by task, beside the backlogs' own (tests add some)."""
    resources = await Resources.open(settings)
    cpu = CpuPool(settings.worker_cpu_processes)

    async def read(path: str, mime_type: str) -> list[PageReading]:
        return await cpu.run(extract, path, mime_type)

    async def render(path: str, mime_type: str, out_dir: str) -> dict[int, str]:
        return await cpu.run(render_pages, path, mime_type, out_dir)

    sources = SqlSources(resources.engine)
    syllabus = SqlSyllabus(resources.engine)
    files = S3Files(resources.s3, settings.bucket("raw"))
    images = S3PageImages(resources.s3, settings.bucket("derived"))
    gateway = create_llm_gateway(settings, resources.engine)
    store = SqlBacklogStore(resources.engine, sources, syllabus)
    backlogs = Backlogs(gateway, store, syllabus, images)
    # What stores each kind of batch's results, by task.
    handlers: dict[str, BatchHandler] = {
        "ocr_text": backlogs.store_ocr,
        "segment": backlogs.store_questions,
        "tag": backlogs.store_topic_tags,
        **(batch_handlers or {}),
    }
    try:
        yield AllActivities(
            core=Activities(cpu=cpu),
            ingestion=IngestionActivities(
                ExtractSource(sources, files, read, render, images),
                StructureSource(sources, syllabus),
                TagSource(sources),
                ReadAnswerKey(sources, store),
                EmbedSource(
                    sources,
                    SqlEmbeddingStore(resources.engine),
                    S3VectorFiles(resources.s3, settings.bucket("embeddings")),
                    create_embedder(settings, resources.http),
                ),
                sources,
            ),
            llm=LlmActivities(gateway, handlers),
            backlog=BacklogActivities(backlogs),
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
            activities=[
                core.ping,
                ingestion.structure_source,
                ingestion.tag_source,
                ingestion.read_answer_key,
                ingestion.refresh_sources,
                ingestion.mark_source_failed,
            ],
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
            activities=[
                llm.batch_ended,
                llm.collect_batch,
                activities.backlog.submit_backlog,
                ingestion.embed_source,
            ],
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
