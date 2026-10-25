# 0005. BullMQ across Node and Python; Postgres as the pipeline record

- Status: Superseded by [0013](0013-temporal-for-durable-workflows.md)
- Date: 2026-10-24

## Context

Ingestion, paper generation, pool top-ups, evals and exports are long-running and must survive restarts and
closed browser tabs. Producers are in Node (api); consumers are in Python (ai) and Node (render).

## Decision

- **BullMQ** on `valkey-queue`: Node `bullmq` 6.x and Python `bullmq` 3.x, pinned as a pair.
- **Queues are split by resource class**, so heavy work never blocks interactive work: `cpu-parse`,
  `llm-batch`, `llm-live`, `embed`, `chem`, `index`, `generate`, `verify`, `render`, `pool`, `eval`.
- **Payloads are versioned, carry ids only, and include the trace context.** Schemas live in
  `packages/contracts`.
- **Stages are idempotent.** Deterministic job ids, and CPU-heavy Python work runs in a process pool so lock
  renewal never stalls.
- **Postgres (`pipeline_runs`) is the source of truth for pipeline state.** A reconciler re-enqueues work lost
  from the queue (ElastiCache Valkey has no AOF).
- **Provider Batch API jobs** are submitted, then polled by a scheduled job. Batch ids live in `llm_batches`; no
  worker waits up to 24 hours.
- A **cross-language contract test** (Node produces a flow, Python consumes it) runs in CI.

## Consequences

- No extra broker service; the same queue system everywhere.
- Python BullMQ has no sandboxed processors, hence the process pool.
- BullMQ's PostgreSQL backend could later remove one stateful service. It is new and slower, so we don't start
  with it.
