# Vidyam

Grounded AI content studio for a coaching center. Teachers chat to generate new question papers, worksheets
and notes from the center's **own** books, PDFs, videos and past papers (Hindi + English), edit them by chat,
and export print-ready PDF/DOCX. Claude and GPT are both supported and switchable.

The plan (v3) is in [`docs/master-plan.md`](docs/master-plan.md); the reasoning behind each
decision is in [`docs/adr`](docs/adr).

## Repository layout

```
apps/
  web/          Next.js 16 frontend (English + Hindi), talks only to the API
  api/          NestJS 12 API: auth, roles, workflows, CRUD, streaming to the browser
  ai/           Python AI engine: the only service that calls LLMs, embeddings and Qdrant
packages/
  contracts/    zod schemas shared by every service (TS types + generated Python models)
  db/           Drizzle schema, migrations, row-level security, seeds
  api-client/   typed API client generated from the API's OpenAPI document
  ui/           shared UI components (shadcn/ui, Tailwind CSS 4) and the theme
  config/       shared ESLint (architecture rules, AI-SDK ban), Prettier, tsconfig presets
infra/docker/   local infrastructure (compose.yml, Caddyfile)
docs/           master plan and architecture decision records
```

Every service follows clean architecture (`domain → application → infrastructure → interface`), enforced by
ESLint (TypeScript) and import-linter (Python).

## Prerequisites

- **Docker** (Docker Desktop or OrbStack)
- **Node** with Corepack. The repo pins pnpm 10 and Node 24 and downloads them for this folder only;
  nothing is installed globally.
- **uv** (installs Python 3.12 automatically)

## First run

```bash
cp .env.example .env
# In .env, replace the two placeholder secrets with random values, e.g. `openssl rand -base64 32`:
#   VIDYAM_AUTH_SECRET, VIDYAM_AI_INTERNAL_TOKEN
pnpm install            # also installs git hooks
uv sync --all-packages
pnpm local:init         # start infrastructure, migrate, seed, create S3 buckets + Qdrant collections
pnpm dev                # web + API + AI engine (with queue workers), hot reload
```

Open **http://localhost:38000** and sign in. `pnpm db:seed` creates these local logins (values from `.env`):

| Role                    | Email (login ID)        | Password                |
| ----------------------- | ----------------------- | ----------------------- |
| Platform + center admin | `admin@vidyam.local`    | `change-me-locally-123` |
| Teacher                 | `teacher@vidyam.local`  | `demo-password-123`     |
| Reviewer                | `reviewer@vidyam.local` | `demo-password-123`     |
| Content operator        | `operator@vidyam.local` | `demo-password-123`     |

There is no email: the admin adds people and resets passwords under **Members** (ADR 0011).

Useful local tools:

| What                                                    | Where                                   |
| ------------------------------------------------------- | --------------------------------------- |
| The app                                                 | http://localhost:38000                  |
| API docs (OpenAPI)                                      | http://localhost:38000/api/docs         |
| Workflows: background work, step by step (Temporal UI)  | http://localhost:38152                  |
| Qdrant dashboard (API key in `.env`)                    | http://localhost:38140/dashboard        |
| SeaweedFS (S3) status                                   | http://localhost:38161                  |
| Database browser (`pnpm --filter @vidyam/db db:studio`) | https://local.drizzle.studio?port=38190 |

### Adding content

Files go into the library with one command, run from the repository root while the app is running
(`pnpm dev` or `pnpm stack:up`). Folders are searched recursively.

```bash
pnpm ingest ~/Desktop/rpsc-polity --kind notes --licence own --meta exam=rpsc --meta subject=polity --wait
```

- `--kind`: `book`, `notes`, `question_paper`, `answer_key`, `booklet`, `image` or `other`
- `--licence`: `own` (the center's material), `third_party` (published books) or `pyq` (past papers)
- Reads PDF, Word (.docx), text/Markdown and images. Kruti Dev text is converted to Unicode Hindi. Scanned
  pages wait for OCR, which needs the AI keys.
- Running it again skips files already imported. Progress is visible in the Temporal UI.

### Run everything in Docker

The same images that will run on AWS can run locally, behind the same Caddy entry point:

```bash
pnpm stack:up     # build and start api, ai (+ worker) and web containers; http://localhost:38000
pnpm stack:down   # stop the app containers and point Caddy back at `pnpm dev`
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
| 38150         | Temporal (durable workflows, gRPC)               |
| 38151         | Valkey for caches (LRU)                          |
| 38152         | Temporal UI                                      |
| 38160 / 38161 | SeaweedFS S3 API / admin UI                      |
| 38170         | render worker health                             |
| 38190         | Drizzle Studio                                   |

## Everyday commands

| Command                            | What it does                                           |
| ---------------------------------- | ------------------------------------------------------ |
| `pnpm local:init`                  | first-time setup (infra, migrations, seed, bootstrap)  |
| `pnpm infra:up` / `infra:down`     | start / stop local infrastructure (data is kept)       |
| `pnpm infra:ps` / `infra:logs`     | status / logs                                          |
| `pnpm dev`                         | run all apps with hot reload (turbo)                   |
| `pnpm lint` / `typecheck` / `test` | checks across TypeScript and Python, cached by turbo   |
| `pnpm test:integration`            | tests against local infrastructure                     |
| `pnpm test:e2e`                    | browser tests against the running app (`pnpm dev`)     |
| `pnpm codegen`                     | regenerate shared types (Python models, API client)    |
| `pnpm test:live`                   | tests against real LLM APIs (**spends money**, opt-in) |
| `pnpm format`                      | Prettier + Ruff                                        |

Commits follow [Conventional Commits](https://www.conventionalcommits.org) with a scope,
e.g. `feat(api): add paper versions`. The commit-msg hook enforces it.
