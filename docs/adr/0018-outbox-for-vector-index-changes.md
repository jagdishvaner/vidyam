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

## Update 2026-10-28: as built (plan v3 step 19)

- **Indexing.** `IndexSource` (`application/indexing.py`) writes a file's chunks into the `chunks` alias from
  their Parquet vectors. It never asks the model again.
  - Each point carries the payload in `domain/indexing.py`: organization, file, kind, licence, language,
    parallel group, subject, exams, year, chapter and topic ids with all their ancestors, primary node, chunk
    kind, pages and printed page label, heading path, text, and `lex`/`lex_roman`.
  - Only trusted tags count: rules, people, or a model at 0.6 confidence or more.
  - A re-index drops the points of chunks that no longer exist.
- **When indexing runs:**
  - at the end of every ingestion, after embedding;
  - after the topic backlog, for the files whose chunks got topics;
  - after OCR, as part of redoing the file.
- **The index keeper** runs inside the AI worker process (`interface/workflows/upkeep.py`):
  - every 5 seconds it applies the outbox, in order;
  - every minute, while the embedding server is up, it starts the `IndexSource` workflow for settled files
    whose chunks lack current vectors or index points.

  The workflow id is the file's, so no file is indexed twice at once. A row that fails is retried on the next
  pass; after 10 failures it stays for a person to look at.

- **System health** shows `index-outbox`: what is waiting, and anything stuck.
- **`coverage_stats`** (migration 0005) is a plain view, always current, with `security_invoker` so row-level
  security applies. It counts passages by kind, and bank questions by type, difficulty and status, per
  syllabus node, including everything below the node. The chat's scope cards and paper planning read it.
- The `questions` collection is not filled yet. The bank's similarity and duplicate checks need it, and they
  come with generation (step 26).
