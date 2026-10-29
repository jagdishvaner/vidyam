"""A test workflow for the API's Temporal worker (ADR 0017): Python workflow code calling the TypeScript
activities on the `api` queue, as generation will. Kept to temporalio imports only, so the workflow sandbox
imports it cleanly."""

from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError, ApplicationError


@workflow.defn(name="ApiRoundTripTest")
class ApiRoundTrip:
    @workflow.run
    async def run(self, ids: dict[str, Any]) -> dict[str, Any]:
        api = workflow.info().task_queue.removesuffix("ai") + "api"  # the sibling queue, prefix and all
        envelope = {"v": 1, "orgId": ids["orgId"]}

        async def call(name: str, payload: dict[str, Any]) -> Any:
            return await workflow.execute_activity(
                name,
                {**envelope, **payload},
                task_queue=api,
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=RetryPolicy(maximum_attempts=3),
            )

        async def failure(name: str, payload: dict[str, Any]) -> str:
            try:
                await call(name, payload)
            except ActivityError as error:
                cause = error.cause
                return cause.type or "" if isinstance(cause, ApplicationError) else type(cause).__name__
            return "none"

        message = {
            "sessionId": ids["sessionId"],
            "messageId": ids["messageId"],
            "blocks": [{"type": "document_ref", "documentId": ids["documentId"], "title": "Test paper",
                        "kind": "question_paper", "version": 1}],
        }  # fmt: skip
        version = {
            "documentId": ids["documentId"], "baseVersion": 0, "content": {"title": "Test paper"},
            "authorKind": "agent",
        }  # fmt: skip
        return {
            "message": await call("append_chat_blocks", message),
            "messageAgain": await call("append_chat_blocks", message),
            "version": await call("save_document_version", version),
            "versionAgain": await call("save_document_version", version),
            "conflict": await failure("save_document_version", {**version, "content": {"title": "Other"}}),
            "running": await call(
                "update_generation_run",
                {"runId": ids["runId"], "status": "running", "slotStates": {"s1": {"state": "generated"}}},
            ),
            "done": await call(
                "update_generation_run",
                {"runId": ids["runId"], "status": "done", "slotStates": {"s2": {"state": "bank"}}},
            ),
            "missing": await failure("update_generation_run", {"runId": ids["messageId"], "status": "done"}),
            "invalid": await failure("append_chat_blocks", {"sessionId": "not-an-id"}),
        }
