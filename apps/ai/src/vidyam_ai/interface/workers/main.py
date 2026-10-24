import asyncio
import logging
import signal

from vidyam_ai.config import Settings, get_settings
from vidyam_ai.generated.contracts import AiQueueName
from vidyam_ai.infrastructure.queue.runner import CpuPool, JobContext, QueueRunner
from vidyam_ai.interface.workers.handlers import HANDLERS


async def run_workers(settings: Settings) -> None:
    cpu = CpuPool(settings.worker_cpu_processes)
    runner = QueueRunner(
        connection=settings.queue_redis_url,
        queues=[queue.value for queue in AiQueueName],
        handlers=HANDLERS,
        context=JobContext(cpu=cpu),
    )
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    try:
        await runner.run(stop)
    finally:
        cpu.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    asyncio.run(run_workers(get_settings()))


if __name__ == "__main__":
    main()
