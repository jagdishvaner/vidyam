# Vidyam

Grounded AI content studio for a coaching center. Teachers chat to generate new question papers, worksheets
and notes from the center's **own** books, PDFs, videos and past papers (Hindi + English), edit them by chat,
and export print-ready PDF/DOCX. Claude and GPT are both supported and switchable.

The plan (v3) is in [`docs/master-plan.md`](docs/master-plan.md); the reasoning behind each
decision is in [`docs/adr`](docs/adr).

## Repository layout

```
apps/
  web/          Next.js 16 app for teachers (English + Hindi), talks only to the API
  admin/        Next.js 16 admin panel on its own subdomain (staff, syllabus, AI, budgets, audit)
  api/          NestJS 12 API: auth, roles, workflows, CRUD, streaming to the browser
  ai/           Python AI engine: the only service that calls LLMs, embeddings and Qdrant
packages/
  contracts/    zod schemas shared by every service (TS types + generated Python models)
  db/           Drizzle schema, migrations, row-level security, seeds
  api-client/   typed API client generated from the API's OpenAPI document
  ui/           shared UI components (shadcn/ui, Tailwind CSS 4) and the theme
  app-shell/    what both Next.js apps share: sign-in, session, API clients, locales, header pieces
  prompts/      prompt templates per task and model family, loaded by the seed
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
- For search: **llama.cpp** (`brew install llama.cpp`), which runs the Qwen3 embedding and rerank models on
  the Mac's GPU. Without it everything else still runs; search waits for it.

## First run

```bash
cp .env.example .env
# In .env, replace the two placeholder secrets with random values, e.g. `openssl rand -base64 32`:
#   VIDYAM_AUTH_SECRET, VIDYAM_AI_INTERNAL_TOKEN
pnpm install            # also installs git hooks
uv sync --all-packages
pnpm local:init         # start infrastructure, migrate, seed, create S3 buckets + Qdrant collections
pnpm models:setup       # once: the Qwen3 search models (~9 GB in ~/.vidyam/models, ~1 hour)
pnpm dev                # web + admin + API + AI engine (with queue workers) + model servers, hot reload
```

Open **http://localhost:38000** (the app) or **http://localhost:38001** (the admin panel) and sign in. `pnpm db:seed` creates these local logins (values from `.env`):

| Role                    | Email (login ID)        | Password                |
| ----------------------- | ----------------------- | ----------------------- |
| Platform + center admin | `admin@vidyam.local`    | `change-me-locally-123` |
| Teacher                 | `teacher@vidyam.local`  | `demo-password-123`     |
| Reviewer                | `reviewer@vidyam.local` | `demo-password-123`     |
| Content operator        | `operator@vidyam.local` | `demo-password-123`     |

There is no email: the admin adds people and resets passwords in the admin panel under **Staff** (ADR 0011).

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
pnpm ingest --manifest ~/Desktop/content/manifest.csv --wait   # the normal way: one row per file
pnpm ingest ~/Desktop/rpsc-polity --kind notes --licence own --meta exam=rpsc --wait   # quick, no manifest
```

- The manifest (template: `fixtures/demo-pack/manifest.csv`) says for each file what it is, its licence,
  subject, language, exams, and chapter or page ranges; it is checked against the syllabus before anything
  is imported. Running it again after an edit updates the files without uploading them twice.
- `--kind`: `book`, `notes`, `question_paper`, `answer_key`, `booklet`, `image` or `other`
- `--licence`: `own` (the center's material), `third_party` (published books) or `pyq` (past papers)
- Reads PDF, Word (.docx), text/Markdown and images. Kruti Dev text is converted to Unicode Hindi. Scanned
  pages wait for OCR, which needs the AI keys.
- Running it again skips files already imported. Progress is visible in the Temporal UI.
- Work that needs an AI model (reading scans, splitting papers into questions, picking topics) waits in
  backlogs: Admin → Content, or `pnpm backlog` to see what each would cost and run it.

### The chat

http://localhost:38000/en/chat (or `/hi/chat` in Hindi), as any staff login, e.g. teacher@vidyam.local.

- **Make something:** "RPSC 2nd grade science paper on gati ke niyam, 30 questions". What's missing is asked on
  cards; when nothing is, a review card shows the paper, what the bank already has, and the cost. Nothing is
  spent before Confirm (generation itself comes with step 26).
- **Ask a doubt:** answered only from your library, with the file and page of each source; when the library
  doesn't cover it, the chat says so.
- Chats can be searched, pinned, renamed, archived and deleted. Without AI keys the built-in test model
  answers, so everything works but the answers are placeholders.

### Searching content

The chat and paper generation find passages the way this command does, so it is the quickest way to see
what the library can answer. It needs the search models (`pnpm dev` or `pnpm models:up`).

```bash
pnpm search --org vidyam-demo-coaching "newton ka teesra niyam"              # Hindi, English or Hinglish
pnpm search --org vidyam-demo-coaching --node work_and_energy "power ka unit"  # within a chapter or topic
```

- Search reads by meaning and by keywords at once, so an English question finds a Hindi passage, and a
  Hinglish spelling finds the Hindi word. The best candidates are then re-read by the rerank model, which
  scores how well each answers the question; passages that don't are left out.
- A passage in both editions of a book (Hindi and English) is shown once, in the query's language, or the
  one asked for with `--language hi|en`.
- Reranking takes about 12 s on the Mac; `--no-rerank` skips it. A repeated query is answered from the cache.

Search quality is measured on the demo pack's 50 teacher questions with known answers, plus 6 it can't
answer; the report goes to `apps/ai/reports/retrieval-eval.md`. The same check runs in CI with the small
models whenever search code changes.

```bash
pnpm eval:retrieval    # the demo pack in a throwaway center (about 15 minutes with the 4B models)
cd apps/ai && uv run vidyam-ai eval-retrieval --org <slug> --queries questions.json   # any center's library
```

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
| 38180 / 38181 | Qwen3 embeddings / rerank (llama-server, Metal)  |
| 38190         | Drizzle Studio                                   |

## Everyday commands

| Command                            | What it does                                           |
| ---------------------------------- | ------------------------------------------------------ |
| `pnpm local:init`                  | first-time setup (infra, migrations, seed, bootstrap)  |
| `pnpm infra:up` / `infra:down`     | start / stop local infrastructure (data is kept)       |
| `pnpm infra:ps` / `infra:logs`     | status / logs                                          |
| `pnpm dev`                         | run all apps with hot reload (turbo)                   |
| `pnpm models:setup` / `models:up`  | fetch and check the search models / run them alone     |
| `pnpm ingest` / `pnpm backlog`     | add content / run its paid AI backlogs                 |
| `pnpm search --org <slug> "…"`     | search a center's content as the chat will             |
| `pnpm eval:retrieval`              | measure search quality on the demo pack                |
| `pnpm lint` / `typecheck` / `test` | checks across TypeScript and Python, cached by turbo   |
| `pnpm test:integration`            | tests against local infrastructure                     |
| `pnpm test:e2e`                    | browser tests against the running app (`pnpm dev`)     |
| `pnpm codegen`                     | regenerate shared types (Python models, API client)    |
| `pnpm test:live`                   | tests against real LLM APIs (**spends money**, opt-in) |
| `pnpm format`                      | Prettier + Ruff                                        |

Commits follow [Conventional Commits](https://www.conventionalcommits.org) with a scope,
e.g. `feat(api): add paper versions`. The commit-msg hook enforces it.
