"""The worker's index keeper (ADR 0018): keeps Qdrant in step with Postgres while the worker runs.

- Every few seconds it applies the outbox, so a file removed in the app leaves search within seconds.
- Once a minute, when the embedding model server is up, it starts `IndexSource` for files left behind: read
  while the server was down, or embedded by an earlier model. The workflow id is the file's, so a file already
  being indexed is not started twice.
"""

import asyncio
import contextlib
import logging
import time
from typing import Any

from temporalio.client import Client
from temporalio.exceptions import WorkflowAlreadyStartedError

from vidyam_ai.application.embedding import Embedder
from vidyam_ai.application.indexing import ApplyOutbox, WaitingSources
from vidyam_ai.generated.contracts import WorkflowType

log = logging.getLogger(__name__)

OUTBOX_EVERY_S = 5.0
CATCH_UP_EVERY_S = 60.0
CATCH_UP_BATCH = 20


class IndexKeeper:
    def __init__(
        self,
        outbox: ApplyOutbox,
        waiting: WaitingSources,
        embedder: Embedder,
        client: Client,
        task_queue: str,
    ) -> None:
        self._outbox = outbox
        self._waiting = waiting
        self._embedder = embedder
        self._client = client
        self._task_queue = task_queue

    async def run(self, stop: asyncio.Event) -> None:
        last_catch_up = 0.0
        while not stop.is_set():
            try:
                applied = await self._outbox.execute()
                if applied:
                    log.info("index outbox: applied %d change(s)", applied)
                if time.monotonic() - last_catch_up >= CATCH_UP_EVERY_S:
                    last_catch_up = time.monotonic()
                    await self.catch_up()
            except Exception:  # the keeper outlives a bad pass; the next one tries again
                log.exception("index keeper pass failed")
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), OUTBOX_EVERY_S)

    async def catch_up(self) -> int:
        if not await self._embedder.ready():
            return 0
        started = 0
        for org_id, source_id in await self._waiting.waiting(self._embedder.version.id, CATCH_UP_BATCH):
            payload: dict[str, Any] = {
                "v": 1,
                "orgId": str(org_id),
                "requestedBy": None,
                "sourceId": str(source_id),
            }
            try:
                await self._client.start_workflow(
                    WorkflowType.index_source.value,
                    payload,
                    id=f"{WorkflowType.index_source.value}:{source_id}",
                    task_queue=self._task_queue,
                )
            except WorkflowAlreadyStartedError:
                continue
            started += 1
        if started:
            log.info("index keeper: started indexing %d file(s) left behind", started)
        return started
