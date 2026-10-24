# 0002. Clean (hexagonal) architecture in every service, enforced by lint

- Status: Accepted
- Date: 2026-10-24

## Context

The platform will grow through many features (ingestion, retrieval, generation, editing, review, admin) and
two providers whose APIs change often. Business rules must not get tangled with frameworks, ORMs or SDKs, or
every provider/framework change becomes a rewrite.

## Decision

Every service and every NestJS module is split into four layers, by folder name:

| Layer            | Contains                                                                | May depend on                               |
| ---------------- | ----------------------------------------------------------------------- | ------------------------------------------- |
| `domain`         | entities, value objects, domain services, repository/port interfaces    | other domain code only. No npm/pip packages |
| `application`    | use cases (commands/queries)                                            | `domain`, port interfaces                   |
| `infrastructure` | adapters implementing ports: Drizzle, asyncpg, Qdrant, Valkey, S3, SDKs | `domain`, `application`                     |
| `interface`      | HTTP controllers, SSE, queue consumers, DTO mapping                     | `application`, `domain`                     |

Files outside these folders (e.g. a NestJS `*.module.ts`) are the **composition root** and wire adapters into
use cases.

Enforcement:

- TypeScript: `packages/config/eslint/clean-architecture.mjs` (eslint-plugin-boundaries).
  `packages/config/test/eslint-presets.test.mjs` proves each forbidden direction is reported.
- Python: the same layout; an import-linter contract is added with the AI engine skeleton (Step 24).

## Consequences

- Use cases are unit-testable with in-memory fakes, without databases or providers.
- Adding a provider, database or framework change touches `infrastructure` only.
- Slightly more files per feature (port + adapter), which is accepted for these benefits.
