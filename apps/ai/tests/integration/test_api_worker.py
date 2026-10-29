"""The API's Temporal worker (ADR 0017, plan v3 step 25), across languages: a Python workflow calls the
TypeScript activities that commit results to the API's tables. A chat message is written once however often
it is retried, a document version is saved only on top of the version it started from, a generation run's
slot states merge, and inputs that can't succeed fail at once instead of retrying.

Needs the API built (`pnpm --filter @vidyam/api build`); the test starts the API's worker on a queue of its
own, so a running `pnpm dev` doesn't interfere."""

from contextlib import AsyncExitStack
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from temporalio.worker import Worker
from vidyam_ai.config import get_settings
from vidyam_ai.infrastructure.temporal.client import connect, wait_for_namespace

from tests.integration.api_roundtrip import ApiRoundTrip
from tests.integration.api_worker import api_worker
from tests.integration.cleanup import remove_org
from tests.integration.test_rls import _admin_url


async def test_python_workflows_commit_through_the_apis_worker() -> None:
    settings = get_settings()
    owner = create_async_engine(_admin_url())
    org_id, session, document, run, message = uuid4(), uuid4(), uuid4(), uuid4(), uuid4()
    async with owner.begin() as conn:
        user = (await conn.execute(text("select id from users order by created_at limit 1"))).scalar_one()
        await conn.execute(
            text("insert into organizations (id, name, slug, created_at) values (:o, 'Test', :s, now())"),
            {"o": org_id, "s": f"api-worker-test-{uuid4().hex[:8]}"},
        )
        await conn.execute(
            text("insert into chat_sessions (id, org_id, user_id) values (:s, :o, :u)"),
            {"s": session, "o": org_id, "u": user},
        )
        await conn.execute(
            text(
                "insert into documents (id, org_id, kind, title, owner_id) "
                "values (:d, :o, 'question_paper', 'Test paper', :u)"
            ),
            {"d": document, "o": org_id, "u": user},
        )
        await conn.execute(
            text(
                "insert into generation_runs (id, org_id, document_id, session_id, workflow_id, spec) "
                "values (:r, :o, :d, :s, :w, '{}'::jsonb)"
            ),
            {"r": run, "o": org_id, "d": document, "s": session, "w": f"test-{run}"},
        )
    client = await connect(settings)
    await wait_for_namespace(client)
    prefix = f"api-worker-test-{uuid4().hex[:8]}-"
    try:
        async with api_worker(f"{prefix}api"), AsyncExitStack() as running:
            await running.enter_async_context(
                Worker(client, task_queue=f"{prefix}ai", workflows=[ApiRoundTrip])
            )
            outcome = await client.execute_workflow(
                ApiRoundTrip.run,
                {
                    "orgId": str(org_id),
                    "sessionId": str(session),
                    "documentId": str(document),
                    "runId": str(run),
                    "messageId": str(message),
                },
                id=f"api-roundtrip-{uuid4()}",
                task_queue=f"{prefix}ai",
            )

        assert outcome["message"] == {"messageId": str(message), "created": True}
        assert outcome["messageAgain"] == {
            "messageId": str(message),
            "created": False,
        }  # once, though retried
        assert outcome["version"] == {"version": 1, "created": True}
        assert outcome["versionAgain"] == {"version": 1, "created": False}
        assert outcome["conflict"] == "Conflict"  # version 0 is gone: no lost edits
        assert (outcome["running"], outcome["done"]) == ({"status": "running"}, {"status": "done"})
        assert outcome["missing"] == "NotFound" and outcome["invalid"] == "InvalidPayload"

        async with owner.connect() as conn:
            blocks = (
                await conn.execute(text("select content from chat_messages where id = :m"), {"m": message})
            ).scalar_one()
            doc = (
                await conn.execute(
                    text("select current_version, content from documents where id = :d"), {"d": document}
                )
            ).one()
            states, finished = (
                await conn.execute(
                    text("select slot_states, finished_at from generation_runs where id = :r"), {"r": run}
                )
            ).one()
        assert blocks[0]["type"] == "document_ref"
        assert (doc.current_version, doc.content) == (1, {"title": "Test paper"})
        assert states == {"s1": {"state": "generated"}, "s2": {"state": "bank"}} and finished is not None
    finally:
        await remove_org(settings, owner, org_id)
        await owner.dispose()
