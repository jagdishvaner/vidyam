# 0018. Changes to indexed content reach Qdrant through an outbox

- Status: Accepted
- Date: 2026-10-27

## Context

Removing a file deleted its Postgres rows and its S3 original, but nothing removed its points from Qdrant.
Once indexing exists, that text would stay searchable and could end up in generated papers.

The API must not call Qdrant: vectors belong to the AI engine ([0008](0008-llm-ownership-and-gateway.md)).
Calling the AI engine from the API in the same request would still lose the change if that call failed
after the database committed.

## Decision

- **`index_outbox` table.** Whenever a change in Postgres affects what Qdrant holds, the same transaction
  inserts an outbox row: `entity` (source, chunk, question), `entityId`, `op` (`delete` or
  `update_payload`), and the payload fields to change.
- **The AI engine applies the outbox to Qdrant** in id order, marks rows `processedAt`, and records
  `attempts` and `lastError` on failure. Applying a row twice has the same effect as once.
- The table has no row-level security: only the AI engine's system role reads it. Each row still carries
  `orgId`.
- Retagging, status changes and removals all use it. Re-embedding does not: that builds a new collection
  and switches the alias ([0016](0016-qwen3-embeddings-and-reranker.md)).

## Consequences

- Qdrant is eventually consistent with Postgres, within seconds. Retrieval also filters by `org_id` and
  current status, so a pending delete cannot leak across centers.
- A growing outbox is the signal that the consumer is down; it is shown on System health.
- Removing a source queues one row; the consumer deletes every point whose `source_id` matches.
