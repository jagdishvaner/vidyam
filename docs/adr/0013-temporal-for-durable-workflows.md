# 0013. Temporal for long-running work (replaces BullMQ)

- Status: Accepted. Supersedes [0005](0005-background-jobs-bullmq.md), and the `valkey-queue` port in
  [0007](0007-local-environment-and-toolchain.md).
- Date: 2026-10-26

## Context

Most of Vidyam's background work is a chain of steps that may take hours:

- a book is read, its scanned pages go to a half-price Batch API that answers within 24 hours, then it is
  tagged and indexed;
- a paper is planned, generated section by section, then verified.

With BullMQ we would have built the rest ourselves:

- a pipeline record and a reconciler for lost jobs;
- a scheduler that polls batch results;
- retry bookkeeping for each step.

BullMQ's Python package, which our AI workers use, is still officially alpha and lacks parts of the Node
feature set.

The owner asked for the strongest option the AI industry uses. Temporal is the most widely adopted durable
execution engine for this kind of work:

- OpenAI runs Codex on it;
- it has first-class TypeScript and Python SDKs;
- it is open source (MIT) and can be self-hosted.

Lighter alternatives (Inngest, Restate, Hatchet, DBOS) are younger, mainly TypeScript-only, or weaker at
handing work from Node to Python.

## Decision

- **Temporal 1.32 replaces BullMQ and `valkey-queue`.**
  - The API (TypeScript) starts workflows by name; the AI engine (Python) implements and runs them.
  - The render worker (Node, Phase 7) will poll its own task queue.
- **Persistence lives in our Postgres** (`temporal` and `temporal_visibility` databases), so there is no new
  stateful service.
- **Locally, compose runs:**
  - a one-off schema step (`temporal-sql-tool`, idempotent);
  - the server, on 38150;
  - a one-off namespace step (`vidyam`, 7-day history);
  - the Temporal UI, on 38152.

  Workers wait for the namespace before polling.

- **Task queues are split by resource:**
  - `ai`: workflows and light activities;
  - `ai-cpu`: parsing and image work;
  - `ai-llm`: provider calls, so that rate limits apply;
  - `render`.
- **Workflows only orchestrate.** Workflow code is replayed after a crash, so it stays deterministic; every I/O
  call is an activity.
- **Payloads are contract JSON** (`packages/contracts`: versioned, camelCase, ids not content), validated when
  they arrive.
  - Input that breaks the contract fails the workflow at once (`InvalidPayload`, non-retryable).
  - Large content stays in S3 or Postgres, keeping workflow history small.
- **Workflow ids are deterministic** (`workflowId()`), so the same work isn't started twice while it runs.
- **Batch API waits become durable timers in a workflow**, not a polling scheduler.
- **`pipeline_runs` stays**, as the business-facing status each file shows in the app, written by activities.
  Temporal is the execution record, so the planned reconciler is dropped.
- **A cross-language contract test runs in CI:** TypeScript starts, Python runs, and invalid input fails without
  retries.

## Consequences

- One more service to run, and less of our own code to maintain: no reconciler or batch poller.
- Every step of every book and paper is visible in the Temporal UI, with retries and errors.
- Each step adds milliseconds of overhead, which is negligible next to seconds-long model calls.
- Workflow code follows Temporal's determinism rules. Activity code has no such constraint.
- On AWS:
  - the server runs on ECS against RDS, with its schema migrated by the same one-off step;
  - the UI must sit behind authentication, since it shows workflow inputs;
  - Temporal Cloud is the managed fallback if self-hosting becomes a burden.
