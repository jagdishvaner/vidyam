# 0017. The API runs a Temporal worker and stays the only writer of chat and document state

- Status: Accepted (to be proven by a spike at the start of phase A5)
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
