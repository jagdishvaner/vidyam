# Vidyam

Grounded AI content studio for a coaching center. Teachers chat to generate new question papers, worksheets
and notes from the center's **own** books, PDFs, videos and past papers (Hindi + English), edit them by chat,
and export print-ready PDF/DOCX. Claude and GPT are both supported and switchable.

The full plan (all 100 steps) is in [`docs/master-plan.md`](docs/master-plan.md); the reasoning behind each
decision is in [`docs/adr`](docs/adr).

## Repository layout

```
apps/
  web/      Next.js 16 frontend                          (Phase 1)
  api/      NestJS API: auth, RBAC, workflows, SSE       (Phase 1)
  ai/       Python AI engine: the only service that calls LLMs, embeddings and Qdrant
  render/   Node worker: PDF / DOCX / Kruti Dev DOCX     (Phase 7)
packages/
  config/   shared ESLint (clean-architecture layers, AI-SDK ban), Prettier, tsconfig presets
infra/
  docker/   local infrastructure (compose.yml, Caddyfile)
docs/adr/   architecture decision records
```

Every service follows clean architecture: `domain → application → infrastructure → interface`.
The rules are enforced by lint (see `packages/config/eslint/clean-architecture.mjs`).

## Prerequisites

- **Docker** (Docker Desktop or OrbStack)
- **Node** with Corepack. The repo pins pnpm 10 and Node 24 and downloads them for this folder only;
  nothing is installed globally.
- **uv** (Python 3.12 is installed by uv automatically)

## Quick start

```bash
cp .env.example .env
pnpm install          # also installs git hooks (lefthook)
uv sync --all-packages
pnpm infra:up         # Postgres, Qdrant, 2× Valkey, SeaweedFS (S3), Mailpit, Caddy
pnpm infra:ps
```

## Local ports

Everything uses the **38000–38190** block, bound to `127.0.0.1` only (not reachable from your network).

| Port          | Service                                          |
| ------------- | ------------------------------------------------ |
| 38000         | **App entry** (Caddy: `/` → web, `/api/*` → api) |
| 38100         | web (Next.js)                                    |
| 38110         | api (NestJS)                                     |
| 38120         | ai (Python, internal)                            |
| 38130         | PostgreSQL 17 (`vidyam`, tests: `vidyam_test`)   |
| 38140 / 38141 | Qdrant HTTP / gRPC (API key in `.env.example`)   |
| 38150         | Valkey for queues (BullMQ, no eviction)          |
| 38151         | Valkey for caches (LRU)                          |
| 38160 / 38161 | SeaweedFS S3 API / admin UI                      |
| 38170         | render worker health                             |
| 38180 / 38181 | Mailpit SMTP / web UI                            |
| 38190         | Drizzle Studio                                   |

## Everyday commands

| Command                            | What it does                                           |
| ---------------------------------- | ------------------------------------------------------ |
| `pnpm infra:up` / `infra:down`     | start / stop local infrastructure (data is kept)       |
| `pnpm infra:ps` / `infra:logs`     | status / logs                                          |
| `pnpm dev`                         | run all apps with hot reload (turbo)                   |
| `pnpm lint` / `typecheck` / `test` | checks across TypeScript and Python, cached by turbo   |
| `pnpm test:integration`            | tests against local infrastructure                     |
| `pnpm test:live`                   | tests against real LLM APIs (**spends money**, opt-in) |
| `pnpm format`                      | Prettier + Ruff                                        |

Commits follow [Conventional Commits](https://www.conventionalcommits.org) with a scope,
e.g. `feat(api): add paper versions`. The commit-msg hook enforces it.
