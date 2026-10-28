"""Activities: the steps workflows run, where all I/O and real work happens. Each validates its input against
the shared contract, then calls a use case. Inputs and results stay contract-shaped JSON (camelCase), so the
TypeScript starters and the Temporal UI see the same documents."""

import asyncio
from collections.abc import Awaitable, Generator, Mapping, Sequence
from contextlib import contextmanager
from typing import Any

from pydantic import BaseModel, ValidationError
from temporalio import activity
from temporalio.exceptions import ApplicationError

from vidyam_ai.application.ingestion import (
    ExtractSource,
    SourceNotFound,
    Sources,
    StructureSource,
    TagSource,
    UnreadableFile,
)
from vidyam_ai.application.llm_gateway import (
    BatchHandler,
    BatchNotFound,
    BatchOutcome,
    BatchRecord,
    LlmError,
    LlmGateway,
    ProviderError,
)
from vidyam_ai.application.ping import handle_ping
from vidyam_ai.generated.contracts import IngestSourceInput, LlmBatchInput, LlmBatchResult, PingInput
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
    """The steps of IngestSourceWorkflow (ADR 0014, plan v3 §5)."""

    def __init__(
        self, extract: ExtractSource, structure: StructureSource, tag: TagSource, sources: Sources
    ) -> None:
        self._extract = extract
        self._structure = structure
        self._tag = tag
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

    @activity.defn(name="structure_source")
    async def structure_source(self, payload: dict[str, Any]) -> dict[str, int]:
        """Sections and chunks, from the stored pages."""
        request = parse(IngestSourceInput, payload)
        try:
            summary = await self._structure.execute(request.org_id, request.source_id, run_id=_run_id())
        except SourceNotFound as error:
            raise ApplicationError(str(error), type="SourceNotFound", non_retryable=True) from error
        return {
            "pages": summary.pages,
            "textPages": summary.text_pages,
            "legacyFontPages": summary.legacy_font_pages,
            "ocrPages": summary.ocr_pages,
            "sections": summary.sections,
            "chunks": summary.chunks,
        }

    @activity.defn(name="tag_source")
    async def tag_source(self, payload: dict[str, Any]) -> int:
        request = parse(IngestSourceInput, payload)
        try:
            return await self._tag.execute(request.org_id, request.source_id, run_id=_run_id())
        except SourceNotFound as error:
            raise ApplicationError(str(error), type="SourceNotFound", non_retryable=True) from error

    @activity.defn(name="mark_source_failed")
    async def mark_source_failed(self, payload: dict[str, Any], reason: str) -> None:
        request = parse(IngestSourceInput, payload)
        await self._sources.mark_failed(request.org_id, request.source_id, run_id=_run_id(), error=reason)


class LlmActivities:
    """The steps of LlmBatchWorkflow. Each kind of batch registers the handler that stores its results."""

    def __init__(self, gateway: LlmGateway, handlers: Mapping[str, BatchHandler]) -> None:
        self._gateway = gateway
        self._handlers = handlers

    @activity.defn(name="llm_batch_ended")
    async def batch_ended(self, payload: dict[str, Any]) -> bool:
        request = parse(LlmBatchInput, payload)
        with _llm_failures():
            return await self._gateway.batch_ended(request.org_id, request.batch_id)

    @activity.defn(name="collect_llm_batch")
    async def collect_batch(self, payload: dict[str, Any]) -> dict[str, Any]:
        request = parse(LlmBatchInput, payload)
        with _llm_failures():
            summary = await self._gateway.collect_batch(request.org_id, request.batch_id, self._handle)
        result = LlmBatchResult(
            batchId=summary.batch_id,
            succeeded=summary.succeeded,
            failed=summary.failed,
            costUsd=float(summary.cost_usd),
        )
        return result.model_dump(mode="json", by_alias=True)

    async def _handle(self, batch: BatchRecord, outcomes: Sequence[BatchOutcome]) -> None:
        handler = self._handlers.get(batch.task)
        if handler is None:
            raise ApplicationError(
                f"nothing stores {batch.task} batch results", type="NoBatchHandler", non_retryable=True
            )
        await handler(batch, outcomes)


@contextmanager
def _llm_failures() -> Generator[None]:
    """Provider outages are retried by Temporal; anything a retry can't fix fails the workflow at once."""
    try:
        yield
    except BatchNotFound as error:
        raise ApplicationError(str(error), type="BatchNotFound", non_retryable=True) from error
    except ProviderError as error:
        if error.retryable:
            raise
        raise ApplicationError(str(error), type="ProviderRejected", non_retryable=True) from error
    except LlmError as error:
        raise ApplicationError(str(error), type=type(error).__name__, non_retryable=True) from error
