"""`vidyam-ai worker`: polls Vidyam's task queues and runs workflows and activities (ADR 0013)."""

import asyncio
import logging
import signal
from contextlib import AsyncExitStack

from temporalio.client import Client
from temporalio.worker import Worker

from vidyam_ai.config import Settings, get_settings
from vidyam_ai.generated.contracts import AiTaskQueue
from vidyam_ai.infrastructure.temporal.client import connect, wait_for_namespace
from vidyam_ai.infrastructure.temporal.cpu import CpuPool
from vidyam_ai.interface.workflows.activities import Activities
from vidyam_ai.interface.workflows.workflows import WORKFLOWS

log = logging.getLogger(__name__)


def create_workers(
    client: Client, activities: Activities, *, task_queue: str = AiTaskQueue.ai
) -> list[Worker]:
    """Workers for the AI engine. Only the `ai` queue has work so far; `ai-cpu` and `ai-llm` get their own
    workers (with their own concurrency limits) when their first activities arrive in Phase 2."""
    return [Worker(client, task_queue=task_queue, workflows=WORKFLOWS, activities=[activities.ping])]


async def run_workers(settings: Settings) -> None:
    client = await connect(settings)
    await wait_for_namespace(client)
    cpu = CpuPool(settings.worker_cpu_processes)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    try:
        async with AsyncExitStack() as running:
            for worker in create_workers(client, Activities(cpu=cpu)):
                await running.enter_async_context(worker)
            log.info("workers polling namespace %r, task queue %r", client.namespace, AiTaskQueue.ai.value)
            await stop.wait()
        log.info("workers stopped")
    finally:
        cpu.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    asyncio.run(run_workers(get_settings()))


if __name__ == "__main__":
    main()
