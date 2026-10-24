"""BullMQ worker runner shared by every AI queue (ADR 0005)."""

import asyncio
import logging
import typing
from collections.abc import Awaitable, Callable, Mapping, Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from typing import Any

from bullmq import Job, UnrecoverableError, Worker

from vidyam_ai.generated.contracts import QueuePrefix

log = logging.getLogger(__name__)

# Single source of truth: @vidyam/contracts (QUEUE_PREFIX).
QUEUE_PREFIX: str = typing.get_args(QueuePrefix.model_fields["root"].annotation)[0]


class CpuPool:
    """Runs CPU-heavy functions (PDF parsing, RDKit, sympy) in separate processes, so the event loop and
    BullMQ's lock renewal never stall and jobs are never double-processed. Functions must be picklable."""

    def __init__(self, processes: int) -> None:
        self._executor = ProcessPoolExecutor(max_workers=processes)

    async def run[T](self, fn: Callable[..., T], *args: Any) -> T:
        return await asyncio.get_running_loop().run_in_executor(self._executor, fn, *args)

    def close(self) -> None:
        self._executor.shutdown(wait=True, cancel_futures=True)


@dataclass(frozen=True)
class JobContext:
    cpu: CpuPool


JobHandler = Callable[[Job, JobContext], Awaitable[Any]]


class QueueRunner:
    """One BullMQ worker per queue; jobs are dispatched to handlers by job name (the payload `kind`)."""

    def __init__(
        self,
        *,
        connection: str,
        queues: Sequence[str],
        handlers: Mapping[str, JobHandler],
        context: JobContext,
        prefix: str = QUEUE_PREFIX,
        lock_duration_ms: int = 120_000,
        concurrency: int = 4,
    ) -> None:
        self._connection = connection
        self._queues = list(queues)
        self._handlers = dict(handlers)
        self._context = context
        self._opts = {
            "connection": connection,
            "prefix": prefix,
            "lockDuration": lock_duration_ms,
            "concurrency": concurrency,
        }

    async def run(self, stop: asyncio.Event) -> None:
        workers = [Worker(queue, self._process, self._opts) for queue in self._queues]  # pyright: ignore[reportArgumentType]
        log.info("workers started for queues: %s", ", ".join(self._queues))
        await stop.wait()
        await asyncio.gather(*(w.close() for w in workers))
        log.info("workers stopped")

    async def _process(self, job: Job, _token: str) -> Any:
        handler = self._handlers.get(job.name)
        if handler is None:
            raise UnrecoverableError(f"no handler for job {job.name!r}")
        return await handler(job, self._context)
