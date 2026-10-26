"""Activities: the steps workflows run, where all I/O and real work happens. Each validates its input against
the shared contract, then calls a use case. Inputs and results stay contract-shaped JSON (camelCase), so the
TypeScript starters and the Temporal UI see the same documents."""

import asyncio
from collections.abc import Awaitable
from typing import Any

from pydantic import BaseModel, ValidationError
from temporalio import activity
from temporalio.exceptions import ApplicationError

from vidyam_ai.application.ingestion import (
    ChunkSource,
    ExtractSource,
    SourceNotFound,
    Sources,
    UnreadableFile,
)
from vidyam_ai.application.ping import handle_ping
from vidyam_ai.generated.contracts import IngestSourceInput, PingInput
from vidyam_ai.infrastructure.temporal.cpu import CpuPool


def parse[M: BaseModel](model: type[M], payload: Any) -> M:
    """A payload that breaks the contract will never succeed, so fail the workflow instead of retrying."""
    try:
        return model.model_validate(payload)
    except ValidationError as error:
        raise ApplicationError(
            f"invalid {model.__name__}: {error}", type="InvalidPayload", non_retryable=True
        ) from error


class Activities:
    """Shared dependencies (CPU pool, later database, S3 and LLM clients) are injected once per worker."""

    def __init__(self, cpu: CpuPool) -> None:
        self._cpu = cpu

    @activity.defn(name="ping")
    async def ping(self, payload: dict[str, Any]) -> dict[str, Any]:
        return handle_ping(parse(PingInput, payload)).model_dump(mode="json", by_alias=True)


async def _heartbeating[T](work: Awaitable[T], *, every_s: float = 10) -> T:
    """Long CPU work reports progress, so a crashed worker is noticed within the heartbeat timeout instead of
    after the activity's full time limit."""
    task = asyncio.ensure_future(work)
    try:
        while True:
            done, _ = await asyncio.wait({task}, timeout=every_s)
            if done:
                return task.result()
            activity.heartbeat()
    except asyncio.CancelledError:
        task.cancel()
        raise


def _run_id() -> str:
    """The workflow this step belongs to, recorded with the pipeline stage it updates."""
    info = activity.info()
    return info.workflow_id or info.activity_id


class IngestionActivities:
    """The steps of IngestSourceWorkflow (ADR 0014)."""

    def __init__(self, extract: ExtractSource, chunk: ChunkSource, sources: Sources) -> None:
        self._extract = extract
        self._chunk = chunk
        self._sources = sources

    @activity.defn(name="extract_source")
    async def extract_source(self, payload: dict[str, Any]) -> dict[str, Any]:
        request = parse(IngestSourceInput, payload)
        try:
            summary = await _heartbeating(
                self._extract.execute(request.org_id, request.source_id, run_id=_run_id())
            )
        except (UnreadableFile, SourceNotFound) as error:
            raise ApplicationError(str(error), type=type(error).__name__, non_retryable=True) from error
        return {
            "pages": summary.pages,
            "textPages": summary.text_pages,
            "legacyFontPages": summary.legacy_font_pages,
            "ocrPages": summary.ocr_pages,
        }

    @activity.defn(name="chunk_source")
    async def chunk_source(self, payload: dict[str, Any]) -> int:
        request = parse(IngestSourceInput, payload)
        return await self._chunk.execute(request.org_id, request.source_id, run_id=_run_id())

    @activity.defn(name="mark_source_failed")
    async def mark_source_failed(self, payload: dict[str, Any], reason: str) -> None:
        request = parse(IngestSourceInput, payload)
        await self._sources.mark_failed(request.org_id, request.source_id, run_id=_run_id(), error=reason)
