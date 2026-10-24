# 0003. Service boundaries: web, api, ai, render

- Status: Accepted
- Date: 2026-10-24

## Context

The stack is polyglot by choice: NestJS for the product backend, Python for AI work (its libraries for PDF/OCR,
Hindi text, math checking and chemistry have no equal in Node), Node for rendering. Unclear ownership between
them would duplicate logic and let behaviour drift.

## Decision

| Service              | Owns                                                                                                                                                | Never does                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `apps/web` (Next.js) | UI, server rendering, calling `/api/*` with the user's cookie                                                                                       | talk to the AI engine, databases or providers          |
| `apps/api` (NestJS)  | auth, RBAC, CRUD, workflow state (versions, review, approvals), quotas, enqueueing jobs, SSE to the browser                                         | call an LLM, embedding model or Qdrant (lint-enforced) |
| `apps/ai` (Python)   | everything touching an LLM, embeddings or vectors: ingestion/OCR, retrieval, generation, chat-editing agent, verification, Batch jobs, usage ledger | own workflow state or talk to the browser              |
| `apps/render` (Node) | PDF, DOCX and Kruti Dev DOCX from paper JSON, using the same React renderer as the web preview                                                      | business logic                                         |

Communication:

- Browser ↔ api: one origin (`/api/*`, via Caddy locally and CloudFront on AWS). First-party cookies, no CORS.
- api → ai, interactive (chat turns): private HTTP with streaming, for the fastest first token.
- api → ai/render, long work (paper generation, ingestion, export): BullMQ jobs, so work survives a closed tab.
  Progress goes through Valkey Streams to the api, which relays it as SSE with heartbeats and `Last-Event-ID`
  resume.
- Shared shapes (DTOs, job payloads, paper JSON, events) come from `packages/contracts`, with generated
  TypeScript and Pydantic types.

## Consequences

- Caching rules, model routing and cost tracking exist once (see 0008).
- Each service scales independently (AI ingestion on Spot, render scales to zero).
- Cross-service changes go through `packages/contracts`, so they are typed and visible in review.
