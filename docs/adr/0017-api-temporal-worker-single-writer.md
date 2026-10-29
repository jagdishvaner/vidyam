# 0017. The API runs a Temporal worker and stays the only writer of chat and document state

- Status: Accepted (the spike passed, 2026-10-29)
- Date: 2026-10-27

## Context

Generating a paper is a Temporal workflow in the AI engine ([0013](0013-temporal-for-durable-workflows.md)).
Its results have to land in the API's tables: new document versions, progress and `document_ref` blocks in the
chat, generation run status.

If the AI engine wrote those rows itself, two services would own the same tables, each with its own idea of
permissions, versions and audit. If it called back into the API over HTTP, every callback would need its own
retries and idempotency.

## Decision

- **The API (NestJS) also runs a Temporal worker on the `api` task queue.**
- Workflows started by the API and run by the AI engine schedule the activities that **commit results**
  (save a document version, append a chat block, finish a generation run) on the `api` queue. The API
  executes them inside its own transactions, with RLS, audit and version checks.
- The AI engine keeps everything that calls a model or touches vectors. It never writes chat or document
  tables.
- Activities on both sides take contract JSON from `packages/contracts`, as all workflow payloads do.

## Consequences

- One writer per table, and Temporal's retries replace hand-written callback retries.
- This mixes a TypeScript and a Python worker in one workflow. Temporal supports it, but we have not done it
  yet, so a spike comes first in A5.
- **Fallback if the spike fails:** the AI engine calls internal, idempotent API endpoints from its activities.
  The single-writer rule stays either way.
- The API process now also polls a task queue. It is light work (database writes), so it shares the API's
  instances rather than needing its own.

## Update 2026-10-29: the spike passed; as built (plan v3 step 25)

`apps/ai/tests/integration/test_api_worker.py` runs a Python workflow that calls the API's TypeScript
activities on the `api` queue, with the API's worker running as its own process. Everything behaves as
decided:

- **A chat message is written once.** It goes in under the id the workflow fixed, so a retry returns
  `created: false`.
- **No edit is lost.** A document version is saved only on top of the version it started from. A retry with
  the same content returns the same version; anything else is a `Conflict`.
- **Generation runs merge.** Their slot states merge, and the finish time is set when the run ends.
- **Failures a retry can't fix are final.** Bad input (`InvalidPayload`), something missing (`NotFound`) and
  a conflict fail at once instead of retrying. Database errors are retried.

**What was built:**

- **Contracts.** `TASK_QUEUES.api` and `API_ACTIVITIES` in `packages/contracts/src/workflows.ts`
  (`save_document_version`, `update_generation_run`, `append_chat_blocks`), with their inputs and results.
  Every input is checked against them.
- **The worker.** The API's worker is `modules/workflows`: activities only, with `@temporalio/worker`
  1.24.0, the same version as the client.
  - The API's server process starts it after it listens. Scripts don't.
  - If Temporal is unreachable it keeps trying every 10 s, so the API still boots.
  - `scripts/api-worker.ts <queue>` runs it alone, for tests.
- **Writes.** The commits go through the API's own services (`CommitResults`, `ManageChats`), inside
  row-level security. A row lock serializes writes to one document or one chat.
- **System health.** The new `api-worker` check asks Temporal how many workers poll the `api` queue, so it
  stays true with several API instances.
- **In Python.** Workflows reach the queue as a sibling of their own: `workflow.info().task_queue` with `ai`
  swapped for `api`. Under a test prefix, that is the prefixed `api` queue.
