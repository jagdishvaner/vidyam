# Architecture Decision Records

Each record captures one decision: the context, what we chose, and what it costs us. A new decision that
changes an old one gets a new record that supersedes it; old records are not rewritten.

| #                                                    | Decision                                                              | Status             |
| ---------------------------------------------------- | --------------------------------------------------------------------- | ------------------ |
| [0001](0001-monorepo-turborepo-uv.md)                | Turborepo + pnpm monorepo, uv workspace for Python                    | Accepted           |
| [0002](0002-clean-architecture.md)                   | Clean (hexagonal) architecture in every service, lint-enforced        | Accepted           |
| [0003](0003-service-boundaries.md)                   | Service boundaries: web, api (NestJS), ai (Python), render            | Accepted           |
| [0004](0004-data-layer.md)                           | PostgreSQL + Qdrant + 2× Valkey + S3                                  | Accepted           |
| [0005](0005-background-jobs-bullmq.md)               | BullMQ across Node and Python; Postgres as pipeline record            | Superseded by 0013 |
| [0006](0006-auth-better-auth.md)                     | Better Auth inside NestJS (Express adapter)                           | Accepted           |
| [0007](0007-local-environment-and-toolchain.md)      | Local ports 38000–38190, toolchain pins                               | Accepted           |
| [0008](0008-llm-ownership-and-gateway.md)            | Only the Python AI engine calls LLMs                                  | Accepted           |
| [0009](0009-web-rendering-and-i18n.md)               | Static shells + streamed user data; locale in the URL                 | Accepted           |
| [0010](0010-api-framework-choices.md)                | NestJS 12 (ESM), Standard Schema validation, OpenAPI from contracts   | Accepted           |
| [0011](0011-admin-created-logins-no-email.md)        | Center admins create logins; no email                                 | Accepted           |
| [0012](0012-content-intake-without-upload-screen.md) | Content handed over directly; no upload screen yet; videos as text    | Accepted           |
| [0013](0013-temporal-for-durable-workflows.md)       | Temporal for long-running work (replaces BullMQ)                      | Accepted           |
| [0014](0014-reading-content-into-the-library.md)     | Reading content: PDFium, Kruti Dev conversion, structure-aware chunks | Accepted           |
| [0015](0015-chat-turns-and-clarification-cards.md)   | Chat turns stream through the API; cards are built by code            | Accepted           |
| [0016](0016-qwen3-embeddings-and-reranker.md)        | Qwen3-Embedding-4B and Qwen3-Reranker-4B, self-hosted                 | Accepted           |
| [0017](0017-api-temporal-worker-single-writer.md)    | API Temporal worker; single writer of chat and documents              | Accepted           |
| [0018](0018-outbox-for-vector-index-changes.md)      | Index changes reach Qdrant through an outbox                          | Accepted           |
| [0019](0019-admin-panel-as-its-own-app.md)           | The admin panel is its own app on its own subdomain                   | Accepted           |

The plan these decisions come from: [`../master-plan.md`](../master-plan.md) (v3; v2 is kept as
[`../master-plan-v2.md`](../master-plan-v2.md)).

Template for new records:

```md
# NNNN. Title

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD

## Context

## Decision

## Consequences
```
