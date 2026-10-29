"""Workflows: durable orchestration only. Temporal replays this code after a crash, so it must be
deterministic; anything that touches the outside world belongs in an activity."""

import asyncio
from datetime import timedelta
from typing import Any
from uuid import UUID

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError, ApplicationError

with workflow.unsafe.imports_passed_through():
    from vidyam_ai.domain.editing import rewrite_summary
    from vidyam_ai.domain.generation import OPEN, groups, message_id, outcome, summary
    from vidyam_ai.generated.contracts import (
        AiTaskQueue,
        ApiActivity,
        BacklogKind,
        EditDocumentInput,
        GenerateDocumentInput,
        GenerateDocumentResult,
        IndexSourceInput,
        IndexSourceResult,
        IngestSourceInput,
        IngestSourceResult,
        LlmBatchInput,
        PingInput,
        RunBacklogInput,
        RunBacklogResult,
        Stages,
        TaskQueue,
        WorkflowType,
    )
    from vidyam_ai.interface.workflows.activities import (
        Activities,
        BacklogActivities,
        GenerationActivities,
        IngestionActivities,
        LlmActivities,
        parse,
    )


def _source_ref(payload: dict[str, Any]) -> dict[str, Any]:
    """The part of an ingestion payload that names the file (what the embed and index steps take)."""
    return {key: payload[key] for key in ("v", "orgId", "requestedBy", "sourceId")}


async def _embed_and_index(ref: dict[str, Any]) -> tuple[int, int]:
    embedded = await workflow.execute_activity_method(
        IngestionActivities.embed_source,
        ref,
        task_queue=_queue(AiTaskQueue.ai_llm),
        start_to_close_timeout=timedelta(hours=1),  # a 1,000-page book is a few thousand chunks
        heartbeat_timeout=timedelta(minutes=2),
        retry_policy=RetryPolicy(maximum_attempts=5, maximum_interval=timedelta(minutes=2)),
    )
    indexed = await workflow.execute_activity_method(
        IngestionActivities.index_source,
        ref,
        start_to_close_timeout=timedelta(minutes=30),
        retry_policy=RetryPolicy(maximum_attempts=5, maximum_interval=timedelta(minutes=2)),
    )
    return embedded, indexed


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
    usable text; tag the chunks with the syllabus by rules; embed them (ADR 0014, plan v3 §5). With
    `stages: structure` the stored pages are kept and only sections, chunks, tags and vectors are redone."""

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
            await workflow.execute_activity_method(
                IngestionActivities.read_answer_key,
                payload,
                start_to_close_timeout=timedelta(minutes=5),
                retry_policy=RetryPolicy(maximum_attempts=5),
            )
            embedded, indexed = await _embed_and_index(_source_ref(payload))
        except ActivityError as error:
            reason = str(error.cause or error)
            await workflow.execute_activity_method(
                IngestionActivities.mark_source_failed,
                args=[payload, reason],
                start_to_close_timeout=timedelta(minutes=1),
            )
            raise ApplicationError(f"ingestion failed: {reason}", type="IngestionFailed") from error
        result = IngestSourceResult(
            sourceId=request.source_id,
            taggedChunks=tagged,
            embeddedChunks=embedded,
            indexedChunks=indexed,
            **structure,
        )
        return result.model_dump(mode="json", by_alias=True)


@workflow.defn(name=WorkflowType.index_source)
class IndexSourceWorkflow:
    """Brings one file's vectors and search points up to date: after the model server was down during its
    ingestion, or after the embedding model changed. Started by the worker's index keeper."""

    @workflow.run
    async def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        request = parse(IndexSourceInput, payload)
        embedded, indexed = await _embed_and_index(payload)
        result = IndexSourceResult(sourceId=request.source_id, embeddedChunks=embedded, indexedChunks=indexed)
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


@workflow.defn(name=WorkflowType.run_backlog)
class RunBacklogWorkflow:
    """One backlog of a center, started by an admin after seeing its estimate (plan v3 §8): submit its
    batches, wait for each through LlmBatch, and after OCR re-chunk the files whose pages became readable."""

    @workflow.run
    async def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        request = parse(RunBacklogInput, payload)
        submitted: dict[str, Any] = await workflow.execute_activity_method(
            BacklogActivities.submit_backlog,
            payload,
            task_queue=_queue(AiTaskQueue.ai_llm),
            start_to_close_timeout=timedelta(minutes=30),  # reading and uploading a few thousand page images
            retry_policy=RetryPolicy(maximum_attempts=3),
        )
        batches: list[str] = submitted["batches"]
        results = await asyncio.gather(
            *(
                workflow.execute_child_workflow(
                    LlmBatchWorkflow.run,
                    {
                        "v": 1,
                        "orgId": str(request.org_id),
                        "requestedBy": payload["requestedBy"],
                        "batchId": batch,
                    },
                    id=f"{WorkflowType.llm_batch.value}:{batch}",
                    task_queue=workflow.info().task_queue,
                )
                for batch in batches
            )
        )
        if request.kind == BacklogKind.ocr and submitted["sources"]:
            await workflow.execute_activity_method(
                IngestionActivities.refresh_sources,
                args=[payload, submitted["sources"]],
                start_to_close_timeout=timedelta(hours=1),
                heartbeat_timeout=timedelta(minutes=5),
                retry_policy=RetryPolicy(maximum_attempts=3),
            )
        if request.kind == BacklogKind.tag and submitted["sources"]:
            await workflow.execute_activity_method(
                IngestionActivities.reindex_sources,
                args=[payload, submitted["sources"]],
                start_to_close_timeout=timedelta(hours=1),
                heartbeat_timeout=timedelta(minutes=5),
                retry_policy=RetryPolicy(maximum_attempts=3),
            )
        result = RunBacklogResult(
            kind=request.kind,
            items=submitted["items"],
            batches=[UUID(batch) for batch in batches],
            succeeded=sum(r["succeeded"] for r in results),
            failed=sum(r["failed"] for r in results),
            costUsd=sum(r["costUsd"] for r in results),
        )
        return result.model_dump(mode="json", by_alias=True)


# --- Generation (plan v3 §7) ----------------------------------------------------------------------------

ATTEMPTS = 3  # a question is written at most this often: once, then twice more with what was wrong
PARALLEL_CALLS = 4  # groups written at once; the provider's rate limits sit behind the ai-llm queue
_WRITING = RetryPolicy(maximum_attempts=3, maximum_interval=timedelta(minutes=1))
_COMMIT = RetryPolicy(maximum_attempts=10, maximum_interval=timedelta(minutes=1))


async def _commit(activity: ApiActivity, payload: dict[str, Any]) -> Any:
    """One of the API's activities (ADR 0017), on its sibling queue: the API writes runs, documents and
    chats."""
    return await workflow.execute_activity(
        activity.value,
        payload,
        task_queue=workflow.info().task_queue.removesuffix(AiTaskQueue.ai.value) + TaskQueue.api.value,
        start_to_close_timeout=timedelta(seconds=30),
        retry_policy=_COMMIT,
    )


def _states(items: list[dict[str, Any]], key: str) -> dict[str, Any]:
    return {
        item[key]: {
            "state": item["state"],
            "questionId": item.get("questionId"),
            "flags": item.get("flags", []),
        }
        for item in items
    }


class _Generation:
    """What making a paper and making notes share: the run's progress, the finished document, the chat's
    message, and failing cleanly."""

    request: GenerateDocumentInput | EditDocumentInput
    payload: dict[str, Any]  # a document's ids, as the writing steps take them

    def _ids(self) -> dict[str, Any]:
        return {"v": 1, "orgId": str(self.request.org_id), "runId": str(self.request.run_id)}

    async def _progress(self, **update: Any) -> None:
        await _commit(ApiActivity.update_generation_run, {**self._ids(), **update})

    async def _finish(
        self, content: dict[str, Any], states: list[str], plan: list[dict[str, Any]]
    ) -> dict[str, Any]:
        request, ids = self.request, self._ids()
        info: dict[str, Any] = await workflow.execute_activity_method(
            GenerationActivities.run_info, self.payload, start_to_close_timeout=timedelta(seconds=30)
        )
        saved = await _commit(
            ApiActivity.save_document_version,
            {"v": 1, "orgId": ids["orgId"], "documentId": str(request.document_id), "baseVersion": 0,
             "content": content, "authorKind": "agent"},
        )  # fmt: skip
        cost: float = await workflow.execute_activity_method(
            GenerationActivities.cost, self.payload, start_to_close_timeout=timedelta(seconds=30)
        )
        counts = outcome(states)
        await self._progress(status="done", slotPlan=plan, actualCostUsd=cost)
        if request.session_id:
            await _commit(
                ApiActivity.append_chat_blocks,
                {
                    "v": 1,
                    "orgId": ids["orgId"],
                    "sessionId": str(request.session_id),
                    "messageId": message_id(request.run_id, "ready"),
                    "blocks": [
                        {
                            "type": "document_ref",
                            "documentId": str(request.document_id),
                            "title": info["title"],
                            "kind": info["kind"],
                            "version": saved["version"],
                        },
                        {
                            "type": "notice",
                            # Anything the teacher needs to look at, or that couldn't be made.
                            "level": "warning"
                            if set(counts) & {"flagged", "insufficient_evidence"}
                            else "info",
                            "text": summary(info["kind"], counts, info["locale"]),
                        },
                    ],
                },
            )
        result = GenerateDocumentResult(
            documentId=request.document_id,
            version=saved["version"],
            outcome=counts,  # pyright: ignore[reportArgumentType]
            costUsd=cost,
        )
        return result.model_dump(mode="json", by_alias=True)

    async def _write_slots(self, slots: list[dict[str, Any]], asked: dict[str, str]) -> list[dict[str, Any]]:
        """Fills the open slots a group at a time (a few at once): write, check each new answer on the other
        provider, and write failures again with what was wrong. `asked`: the teacher's changes, by slot."""
        by_id = {slot["slotId"]: slot for slot in slots}
        used: list[str] = []
        gate = asyncio.Semaphore(PARALLEL_CALLS)

        async def fill(group: list[dict[str, Any]], final: bool) -> None:
            async with gate:
                feedback = {s["slotId"]: s["flags"] for s in group if s["state"] == "flagged"}
                requests = {s["slotId"]: asked[s["slotId"]] for s in group if s["slotId"] in asked}
                written: dict[str, Any] = await workflow.execute_activity_method(
                    GenerationActivities.write_questions,
                    args=[self.payload, group, list(used), feedback, final, requests],
                    task_queue=_queue(AiTaskQueue.ai_llm),
                    start_to_close_timeout=timedelta(minutes=10),
                    retry_policy=_WRITING,
                )
                used.extend(written["chunkIds"])
                done: list[dict[str, Any]] = written["slots"]
                new = [s for s in done if s["state"] == "generated"]
                if new:
                    checked: list[dict[str, Any]] = await workflow.execute_activity_method(
                        GenerationActivities.check_answers,
                        args=[self.payload, new, written["modelId"]],
                        task_queue=_queue(AiTaskQueue.ai_llm),
                        start_to_close_timeout=timedelta(minutes=10),
                        retry_policy=_WRITING,
                    )
                    done = [next((c for c in checked if c["slotId"] == s["slotId"]), s) for s in done]
                by_id.update({s["slotId"]: s for s in done})
                await self._progress(slotStates=_states(done, "slotId"))

        for attempt in range(ATTEMPTS):
            todo = groups([by_id[slot["slotId"]] for slot in slots])
            if not todo:
                break
            await asyncio.gather(*(fill(group, attempt == ATTEMPTS - 1) for group in todo))
        return [by_id[slot["slotId"]] for slot in slots]

    async def _write_sections(
        self, sections: list[dict[str, Any]], asked: dict[str, str]
    ) -> list[dict[str, Any]]:
        """Writes the open sections (a few at once), each checked for grounding, failures again with what was
        wrong. `asked`: the teacher's changes, by section."""
        sections = list(sections)
        used: list[str] = []
        gate = asyncio.Semaphore(PARALLEL_CALLS)

        async def write(index: int, final: bool) -> None:
            async with gate:
                section = sections[index]
                written: dict[str, Any] = await workflow.execute_activity_method(
                    GenerationActivities.write_notes_section,
                    args=[
                        self.payload,
                        section,
                        list(used),
                        section["flags"],
                        final,
                        asked.get(section["nodeId"]),
                    ],
                    task_queue=_queue(AiTaskQueue.ai_llm),
                    start_to_close_timeout=timedelta(minutes=10),
                    retry_policy=_WRITING,
                )
                used.extend(written["chunkIds"])
                sections[index] = written["section"]
                await self._progress(slotStates=_states([sections[index]], "nodeId"))

        for attempt in range(ATTEMPTS):
            todo = [n for n, section in enumerate(sections) if section["state"] in OPEN]
            if not todo:
                break
            await asyncio.gather(*(write(n, attempt == ATTEMPTS - 1) for n in todo))
        return sections

    async def _fail(self, error: ActivityError) -> ApplicationError:
        """The run failed and the chat says so (which also frees the chat for new work)."""
        reason = str(error.cause or error)
        try:
            await self._progress(status="failed", error=reason[:2000])
            if self.request.session_id:
                await _commit(
                    ApiActivity.append_chat_blocks,
                    {
                        "v": 1,
                        "orgId": str(self.request.org_id),
                        "sessionId": str(self.request.session_id),
                        "messageId": message_id(self.request.run_id, "failed"),
                        "blocks": [{"type": "error", "code": "generation_failed",
                                    "message": f"Making this stopped: {reason}"}],
                    },
                )  # fmt: skip
        except ActivityError:
            workflow.logger.exception("couldn't record that run %s failed", self.request.run_id)
        return ApplicationError(f"generation failed: {reason}", type="GenerationFailed")


@workflow.defn(name=WorkflowType.generate_paper)
class GeneratePaperWorkflow(_Generation):
    """A confirmed question paper or worksheet (plan v3 §7): plan the slots and fill what the bank can,
    write the rest a chapter and question type at a time (a few groups at once), check every new answer on
    the other provider, write failures again with what was wrong, then assemble the sets and tell the chat.
    Slot states reach the run as each group finishes, for the canvas to show."""

    @workflow.run
    async def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.request, self.payload = parse(GenerateDocumentInput, payload), payload
        try:
            slots: list[dict[str, Any]] = await workflow.execute_activity_method(
                GenerationActivities.plan_paper,
                payload,
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=RetryPolicy(maximum_attempts=5),
            )
            await self._progress(status="running", slotPlan=slots, slotStates=_states(slots, "slotId"))
            slots = await self._write_slots(slots, {})
            content: dict[str, Any] = await workflow.execute_activity_method(
                GenerationActivities.assemble_paper,
                args=[payload, slots],
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=RetryPolicy(maximum_attempts=5),
            )
            return await self._finish(content, [slot["state"] for slot in slots], slots)
        except ActivityError as error:
            raise await self._fail(error) from error


@workflow.defn(name=WorkflowType.generate_notes)
class GenerateNotesWorkflow(_Generation):
    """Confirmed notes or a revision sheet (plan v3 §7): a section per chapter or topic, each written from
    that part of the center's material with citations and checked for grounding; failures are written again
    with what was wrong, then left flagged."""

    @workflow.run
    async def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.request, self.payload = parse(GenerateDocumentInput, payload), payload
        try:
            sections: list[dict[str, Any]] = await workflow.execute_activity_method(
                GenerationActivities.plan_notes,
                payload,
                start_to_close_timeout=timedelta(minutes=2),
                retry_policy=RetryPolicy(maximum_attempts=5),
            )
            await self._progress(status="running", slotPlan=sections, slotStates=_states(sections, "nodeId"))
            sections = await self._write_sections(sections, {})
            content: dict[str, Any] = await workflow.execute_activity_method(
                GenerationActivities.assemble_notes,
                args=[payload, sections],
                start_to_close_timeout=timedelta(minutes=1),
                retry_policy=RetryPolicy(maximum_attempts=5),
            )
            return await self._finish(content, [section["state"] for section in sections], sections)
        except ActivityError as error:
            raise await self._fail(error) from error


REWRITTEN = ("generated", "verified")  # a question good enough to take its slot
DOCUMENT_IDS = ("v", "orgId", "requestedBy", "documentId", "runId", "sessionId", "modelId")


@workflow.defn(name=WorkflowType.edit_document)
class EditDocumentWorkflow(_Generation):
    """Questions or sections of a document written again, as the teacher asked in the chat (plan v3 §6.9):
    the same writing and checks as making it, each with the teacher's words and the item as it stands. Only
    items that pass replace the old ones; the edit is saved as the next version, together with the chat's
    message, only if nobody changed the document meanwhile."""

    @workflow.run
    async def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        edit = parse(EditDocumentInput, payload)
        self.request = edit
        # The writing steps take a document's ids, as when it was made.
        self.payload = {key: payload[key] for key in DOCUMENT_IDS}
        asked = {r.item_id: r.instruction for r in edit.requests}
        try:
            planned: dict[str, Any] = await workflow.execute_activity_method(
                GenerationActivities.plan_rewrite,
                payload,
                start_to_close_timeout=timedelta(minutes=1),
                retry_policy=RetryPolicy(maximum_attempts=5),
            )
            items: list[dict[str, Any]] = planned["items"]
            paper = planned["kind"] == "paper"
            key = "slotId" if paper else "nodeId"
            before = {item[key]: item for item in items}
            await self._progress(status="running", slotPlan=items, slotStates=_states(items, key))
            after = await (self._write_slots(items, asked) if paper else self._write_sections(items, asked))
            ops: list[dict[str, Any]] = []
            kept: list[str] = []
            for item in after:
                if (
                    paper
                    and item["state"] in REWRITTEN
                    and item["questionId"] != before[item[key]]["questionId"]
                ):
                    ops.append({"op": "replace_item", "slotId": item[key], "questionId": item["questionId"]})
                elif not paper and item["state"] == "verified":
                    ops.append({"op": "replace_section", "section": item})
                else:
                    kept.append((item.get("flags") or [item["state"]])[0])
            info: dict[str, Any] = await workflow.execute_activity_method(
                GenerationActivities.run_info, self.payload, start_to_close_timeout=timedelta(seconds=30)
            )
            cost: float = await workflow.execute_activity_method(
                GenerationActivities.cost, self.payload, start_to_close_timeout=timedelta(seconds=30)
            )
            await self._progress(actualCostUsd=cost)
            return await _commit(
                ApiActivity.apply_document_edits,
                {
                    "v": 1,
                    "orgId": str(edit.org_id),
                    "documentId": str(edit.document_id),
                    "runId": str(edit.run_id),
                    "baseVersion": edit.base_version,
                    "ops": ops,
                    "summary": rewrite_summary(edit.summary, len(ops), kept, info["locale"]),
                    "sessionId": str(edit.session_id) if edit.session_id else None,
                    "messageId": message_id(edit.run_id, "edited"),
                },
            )
        except ActivityError as error:
            raise await self._fail(error) from error


WORKFLOWS = [
    PingWorkflow,
    IngestSourceWorkflow,
    LlmBatchWorkflow,
    RunBacklogWorkflow,
    IndexSourceWorkflow,
    GeneratePaperWorkflow,
    GenerateNotesWorkflow,
    EditDocumentWorkflow,
]
