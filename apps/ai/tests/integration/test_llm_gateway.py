"""The LLM gateway against real Postgres and Temporal, on the stub model: routes, prompts and budgets come
from the seeded registry, every call lands in the center's usage ledger, and a batch runs through
LlmBatchWorkflow to collection. Runs in a throwaway organization on its own task queues, and removes
everything it created."""

from collections.abc import Sequence
from contextlib import AsyncExitStack
from dataclasses import replace
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine
from vidyam_ai.application.llm_gateway import (
    BatchItem,
    BatchOutcome,
    BatchRecord,
    BudgetExceeded,
    Caller,
    LlmRequest,
)
from vidyam_ai.config import get_settings
from vidyam_ai.infrastructure.db.engine import create_engine
from vidyam_ai.infrastructure.db.generated.tables import t_llm_batches, t_llm_calls
from vidyam_ai.infrastructure.llm import create_llm_gateway
from vidyam_ai.infrastructure.temporal.client import connect, wait_for_namespace
from vidyam_ai.interface.workflows.worker import create_workers, open_activities

from tests.integration.test_rls import _admin_url


async def test_calls_batches_and_budgets_on_the_stub_model() -> None:
    settings = get_settings().model_copy(update={"ai_stub": True})  # never a real provider, keys or not
    owner = create_async_engine(_admin_url())
    app = create_engine(settings.async_database_url)
    org_id = uuid4()
    async with owner.begin() as conn:
        await conn.execute(
            text(
                "insert into organizations (id, name, slug, created_at) values (:id, 'LLM test', :s, now())"
            ),
            {"id": org_id, "s": f"llm-test-{org_id.hex[:8]}"},
        )
    try:
        llm = create_llm_gateway(settings, app)

        # One call: the seeded route (Haiku), the seeded prompt, a ledger row in this center.
        request = LlmRequest(
            Caller(org_id, workflow_id="test"),
            "chat_title",
            variables={"first_message": "Make an RPSC science paper on motion", "language": "English"},
        )
        reply = await llm.complete(request)
        assert reply.text == "Make an RPSC science paper on"
        assert (reply.model_id, reply.provider, reply.prompt_version) == (
            "claude-haiku-5-5",
            "stub",
            "chat_title.any.v1",
        )

        # The answer check runs on the provider that didn't write the question (crossProvider route option).
        solve = LlmRequest(Caller(org_id), "verify_solve", variables={"question": "Question: 2 + 2 = ____"})
        by_gpt = await llm.complete(replace(solve, written_by="gpt-6-astra"))
        by_claude = await llm.complete(replace(solve, written_by="claude-opus-5-5"))
        assert (by_gpt.model_id, by_claude.model_id) == ("claude-opus-5-5", "gpt-6-astra")

        # A batch through the workflow: submitted, waited on, collected once, at no cost on the stub.
        stored: list[BatchOutcome] = []

        async def store(batch: BatchRecord, outcomes: Sequence[BatchOutcome]) -> None:
            stored.extend(outcomes)

        items = [
            BatchItem(f"msg-{i}", {"first_message": f"Doubt about topic {i}", "language": "Hindi"})
            for i in range(2)
        ]
        batch_id = await llm.submit_batch(Caller(org_id), "chat_title", items)
        client = await connect(settings)
        await wait_for_namespace(client)
        prefix = f"llm-test-{uuid4().hex[:8]}-"
        async with (
            open_activities(settings, batch_handlers={"chat_title": store}) as activities,
            AsyncExitStack() as running,
        ):
            for worker in create_workers(client, activities, task_queue_prefix=prefix):
                await running.enter_async_context(worker)
            result = await client.execute_workflow(
                "LlmBatch",
                {"v": 1, "orgId": str(org_id), "requestedBy": None, "batchId": str(batch_id)},
                id=f"LlmBatch:{batch_id}",
                task_queue=f"{prefix}ai",
            )
        assert result == {"batchId": str(batch_id), "succeeded": 2, "failed": 0, "costUsd": 0.0}
        assert sorted(o.custom_id for o in stored) == ["msg-0", "msg-1"]
        assert all(o.reply and o.reply.text.startswith("Doubt about topic") for o in stored)

        async with owner.connect() as conn:
            [batch] = (await conn.execute(select(t_llm_batches).where(t_llm_batches.c.id == batch_id))).all()
            calls = (
                await conn.execute(
                    select(t_llm_calls).where(
                        t_llm_calls.c.org_id == org_id, t_llm_calls.c.task == "chat_title"
                    )
                )
            ).all()
        assert (batch.status, batch.provider, batch.request_count) == ("collected", "stub", 2)
        assert batch.collected_at is not None and batch.meta["modelId"] == "claude-haiku-5-5"
        assert len(calls) == 3
        assert {(c.provider, c.model_id, c.cost_usd, c.prompt_version) for c in calls} == {
            ("stub", "stub", Decimal(0), "chat_title.any.v1")
        }
        assert sorted(c.is_batch for c in calls) == [False, True, True]
        assert all(c.input_tokens > 0 and c.output_tokens > 0 for c in calls)

        # A center budget that is used up stops the next call before it is made.
        async with owner.begin() as conn:
            await conn.execute(
                text("insert into quotas (org_id, monthly_limit_usd) values (:org, 0)"), {"org": org_id}
            )
        with pytest.raises(BudgetExceeded, match="center's monthly AI budget"):
            await llm.complete(request)
    finally:
        async with owner.begin() as conn:
            await conn.execute(text("delete from organizations where id = :id"), {"id": org_id})
        await owner.dispose()
        await app.dispose()
