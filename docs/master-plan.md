# Vidyam — Master Plan v2 (1 → 100)

> **Approved 2026-10-24.** Changes made during implementation are recorded as ADRs, not by editing this text:
>
> - Python tasks run through `package.json` wrappers around `uv run` (the plan's stated fallback), because
>   Turborepo's experimental Python support has no `dev` task or JS→Python dependencies. See ADR 0001.
> - Node **24** LTS instead of 22 (22 loses support in April 2027, around launch). TypeScript pinned to 6.0 because
>   typescript-eslint does not yet support TypeScript 7. See ADR 0007.
> - No email: center admins create logins and reset passwords; Mailpit is gone. See ADR 0011.
> - Content is handed over directly and ingested from a folder; no upload screen yet (step 27 deferred). Videos
>   arrive as text from the center (step 42 dropped). See ADR 0012.
> - Temporal replaces BullMQ for background work (durable workflows, built-in waits for Batch API results); the
>   reconciler and batch poller in steps 28 and 55 are no longer needed. See ADR 0013.
> - Content is read with PDFium (not the AGPL PyMuPDF) and our own Kruti Dev converter; `pnpm ingest` is the
>   intake. See ADR 0014.

## Context

A coaching center in Rajasthan has thousands of books, PDFs (many scanned, many in legacy Hindi fonts such as Kruti Dev), lecture videos, images and past papers. Its exams are JEE/NEET, CBSE/ICSE/RBSE, UPSC/SSC/Banking, RPSC 1st/2nd grade and REET. The content is mixed Hindi and English.

Teachers should be able to:

- generate **new** question papers, worksheets and notes by chat, grounded **only** in the center's own content;
- edit them by chat;
- export print-ready PDF/DOCX.

Claude and GPT are both supported, switchable per chat and per task.

**Why v2:** after v1 was approved I started coding before the stack had been agreed with you. That scaffold gets deleted in Step 1. It comprises `backend/`, a partly created `frontend/`, a compose file, and a Postgres container on port 55432.

This plan fixes every decision up front: repo structure, backend, database, frontend, local ports, and all 100 execution steps. **Nothing is built until you approve it.**

**Honest quality bar:** no AI system can guarantee 100%. We get close with three things, all measured against golden test sets:

1. strict grounding: every item cites its source passages;
2. multi-stage verification, including a blind re-solve of each answer by the _other_ AI provider;
3. human approval before anything is published.

---

## 1. Decisions (locked)

| Area             | Decision                                                                                                                                                                                                                    | By                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Repo             | **Turborepo 2.11** (pinned) + pnpm workspaces; **uv workspace** for Python, using Turborepo's Python workspace support (experimental flag, hence the pin)                                                                   | You                         |
| Architecture     | **Clean / hexagonal** in every service: domain → application (use cases) → infrastructure (adapters) → interface (HTTP/queues). Import-boundary lint rules enforce it.                                                      | You                         |
| API backend      | **NestJS** (TypeScript, **Express adapter**, which Better Auth needs). Handles auth, RBAC, business workflows, CRUD, quotas and SSE streaming to the browser. **Never calls an LLM**; a lint rule blocks the provider SDKs. | You                         |
| AI backend       | **Python AI engine**: FastAPI internal API plus BullMQ workers. The **only** owner of LLM calls, embeddings and vectors: ingestion/OCR, retrieval, generation, chat-editing agent, verification.                            | You + me (single LLM owner) |
| Node worker      | **Render worker**: PDF via headless Chromium, DOCX via Pandoc, Kruti Dev DOCX                                                                                                                                               | You                         |
| Frontend         | **Next.js 16** (App Router, hybrid SSR/streaming + rich client), **TanStack** Query/Table/Form/Virtual, **Tailwind**, shadcn/ui                                                                                             | You                         |
| System of record | **PostgreSQL 17** (official image, matching the RDS major version), with row-level security per org                                                                                                                         | You                         |
| Vector DB        | **Qdrant 1.20**, the only retrieval engine: dense + BM25 keyword (Hindi-normalized) hybrid, int8 quantization, tenant index                                                                                                 | You                         |
| Queue + cache    | **Valkey 8** (open-source Redis, ~20–33% cheaper on AWS) as **two instances**: `valkey-queue` (BullMQ, no eviction, persisted) and `valkey-cache` (caches, rate limits, resumable SSE streams)                              | You (Redis) + me            |
| Jobs             | **BullMQ** (Node 6.x + Python 3.x, pinned as a pair). Postgres is the record of pipeline state; a reconciler re-enqueues anything lost.                                                                                     | Me                          |
| Object storage   | S3 on AWS; **SeaweedFS** locally (Apache-2.0, mature S3 API). The MinIO image is no longer published.                                                                                                                       | Me                          |
| Schema owner     | **Drizzle ORM** (pinned 0.45.x) in `packages/db` owns every migration. Python reads the same schema through generated SQLAlchemy Core tables, and CI fails on drift.                                                        | Me                          |
| Auth             | **Better Auth** (open source; sessions in Postgres; organizations and roles; UUID ids) via `@thallesp/nestjs-better-auth`                                                                                                   | Me                          |
| LLMs             | Claude (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`) via Claude Platform on AWS; GPT (`gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-luna`) via OpenAI. Admin-switchable per task, teacher-switchable per chat.        | You                         |
| Run order        | **Local Docker first** on a dedicated port block (38000–38190), then AWS ap-south-1 (Mumbai)                                                                                                                                | You                         |

**Why this data layer is the best combination for accuracy and speed:**

- **PostgreSQL** is the single source of truth: content, item bank, chats, versions, auth, pipeline state, ledger.
- **Qdrant** does one thing: retrieval. In a single Query API call it searches meaning (dense vectors) and exact Hindi/English keywords (BM25 over normalized and romanized text), fuses the two, and filters by org, exam, chapter and licence, in milliseconds.
- **Valkey** keeps queues reliable and makes repeat work instant: cached embeddings, cached retrieval, resumable live streams.

No pgvector and no OpenSearch, so there are no duplicate search paths that can disagree.

---

## 2. System architecture

```
                         ┌──────────── http://localhost:38000 (Caddy; CloudFront on AWS) ────────────┐
 Browser ───────────────►│  /*  → Next.js web (38100)        /api/* → NestJS API (38110)           │
   one origin:           └───────────────────────────────────────────────────────────────────────────┘
   first-party cookies,          SSR fetches forward the cookie        │ auth · RBAC · CRUD · versions
   no CORS                       to the API's internal URL             │ quotas · SSE (heartbeat, resumable)
                                                                       │
                              chat turns: internal HTTP stream ────────┼──────► Python AI engine (38120)
                              papers/ingest/export: BullMQ jobs ───────┤        FastAPI: chat · edit-agent ·
                              progress: Valkey Streams ◄───────────────┘        retrieve · verify (sync)
                                                                                 Workers: ingest · OCR · tag ·
                                                                                 embed · generate-paper ·
                                                                                 pool · evals
                                                     Node render worker (38170 health): PDF · DOCX · Kruti Dev DOCX
 ┌──────────────────────────────────── Data layer ───────────────────────────────────────────────────┐
 │ PostgreSQL 17 (38130)    Qdrant 1.20 (38140/38141)    valkey-queue (38150)    SeaweedFS S3 (38160) │
 │ truth + RLS per org      chunks · questions · figures valkey-cache (38151)    raw · derived ·      │
 │                                                                                exports · embeddings │
 └────────────────────────────────────────────────────────────────────────────────────────────────────┘
       LLM providers (Claude Platform on AWS · OpenAI) ← called ONLY by the AI engine
```

**Boundary rules**

- **web** talks only to `/api/*` (NestJS). Server components forward the user's cookie to the API's internal URL and never cache per-user fetches. Next 16's `proxy.ts` only does redirects; real authorization always happens in NestJS.
- **Chat turns** stream straight from NestJS to the AI engine over private HTTP, so the first token arrives fast.
- **Full paper generation, ingestion and export** are BullMQ jobs, so they survive a closed tab.
  - Progress is written to **Valkey Streams**.
  - NestJS relays it as SSE: compression off, heartbeat every 15 s, resume via `Last-Event-ID`.
- **Item content and verification results** come back from the AI engine; **NestJS commits** the document versions and workflow state.

---

## 3. Monorepo layout

```
vidyam/
├── apps/
│   ├── web/                       Next.js 16
│   │   └── src/app/               (auth) (studio) (library) (bank) (review) (admin)
│   │       src/features/<feature>/ components · hooks · TanStack queries/forms
│   │       src/lib/               api client, SSE client, i18n (Hindi/English UI)
│   ├── api/                       NestJS (Express)
│   │   └── src/modules/{identity,library,knowledge,item-bank,studio,review,export,admin,billing}/
│   │           each: domain/ application/ infrastructure/ interface/
│   │       src/shared/            kernel: ids, Result/errors, clock, events, pagination, RLS session
│   ├── ai/                        Python AI engine (uv project; images: ai-api, ai-ingest, ai-chem)
│   │   └── src/vidyam_ai/
│   │       domain/                Page, Chunk, Figure, Question, PaperSpec, Slot, VerificationResult
│   │       application/           ingest_source, parse_page, segment_paper, index_chunks, retrieve,
│   │                              plan_slots, generate_section, verify_item, edit_document, top_up_pool
│   │       infrastructure/        llm/ (gateway, providers, prompt layout, batch), pdf/, ocr/, devanagari/,
│   │                              chem/, embeddings/, rerank/, qdrant/, db/ (generated Core tables + repos),
│   │                              s3/, queue/
│   │       interface/             http/ (internal FastAPI) · workers/ (BullMQ consumers)
│   └── render/                    Node BullMQ consumer: Playwright PDF, Pandoc DOCX, Kruti Dev DOCX
├── packages/
│   ├── contracts/                 zod = single source for DTOs, job payloads (versioned, ids only), paper JSON,
│   │                              events → TS types + JSON Schema → generated Pydantic (committed, CI-checked)
│   ├── db/                        Drizzle schema + migrations + seeds + RLS policies (incl. Better Auth tables)
│   ├── api-client/                generated from NestJS OpenAPI (used by web)
│   ├── paper-renderer/            React: paper JSON → HTML (KaTeX, Devanagari) for preview AND PDF export
│   ├── ui/                        shadcn/ui components + theme
│   ├── prompts/                   versioned prompt templates per model family
│   └── config/                    eslint (layer rules, banned LLM SDKs in api/web), prettier, tsconfig, ruff, pyright
├── infra/
│   ├── docker/                    compose.yml, Caddyfile, Dockerfiles (ARM64 + AMD64)
│   └── aws/                       CDK (Phase 9)
├── evals/                         golden sets + runners
├── docs/adr/
└── turbo.json · pnpm-workspace.yaml · pyproject.toml (uv workspace) · uv.lock · .env.example
```

**Clean-architecture rules:**

- `domain` imports nothing external.
- `application` depends only on `domain` plus port interfaces.
- `infrastructure` implements the ports: Drizzle, generated Core tables, Qdrant, Valkey, S3, LLM SDKs.
- `interface` wires HTTP and queues to use cases.

**Turborepo pipeline:** `contracts#build` (zod → JSON Schema → Pydantic) runs before the `ai`, `api` and `web` tasks. Python tasks run through Turborepo's uv integration, with `uv.lock` and the source files as cache keys. Docker images are built with `uv sync --frozen --package ai --no-dev`.

---

## 4. Data layer design

### PostgreSQL 17 (truth)

- **Tables:**
  - auth & tenancy: orgs, users, Better Auth sessions/accounts/members (UUID ids), audit_log;
  - content: sources, pages, assets;
  - syllabus: taxonomy_nodes, exams, exam_syllabus, exam_blueprints, glossary_terms;
  - retrieval bookkeeping: chunks (text + metadata), embedding_versions;
  - item bank: questions, question_tags, pyq_refs, student_batches, item_exposure;
  - documents & chat: documents, document_versions, comments, chat_sessions, chat_messages, content_templates, feedback;
  - LLM config & spend: llm_models, task_routes, prompt_templates, llm_calls (ledger), llm_batches, quotas;
  - pipeline_runs: stage state per file, used by the reconciler.
- **Row-level security:** every repository in NestJS and Python sets `SET LOCAL app.org_id`, a second line of defence after the RBAC checks.
- `pg_trgm` keyword search for admin screens only. Retrieval is Qdrant's job.

### Qdrant 1.20 (retrieval)

- **Collections and points:**
  - collections `chunks`, `questions`, `figures`;
  - point id = Postgres row UUID;
  - text and key metadata are kept in the payload, so a search never needs a Postgres round-trip.
- **Named vectors:**
  - `dense`: the embedding bake-off winner;
  - optional `sparse`: BGE-M3 sparse, only if it wins the keyword bake-off.
- **No ColBERT multivectors on chunks.** At about 3M chunks they would take roughly 0.9 TB even quantized; a cross-encoder reranker on the top 50 is better value.
- **Hindi/English keyword search:**
  - The Python normalizer applies NFC; folds nukta, anusvara and chandrabindu; strips ZWJ/ZWNJ; converts Devanagari digits; cleans Kruti Dev residue.
  - It writes a `lex` payload field plus a romanized (ISO-15919) `lex_roman` copy, so Hinglish queries such as "Newton ke niyam" match.
  - Both fields get a full-text index with the whitespace tokenizer, BM25 scoring and custom stopwords. Qdrant has no Hindi stemmer, hence our own normalizer, which also runs at query time.
- **One query per search:**
  1. prefetch dense top-100 and BM25 top-100 inside the filters;
  2. weighted RRF or DBSF fusion (chosen by the eval);
  3. cross-encoder rerank (AI engine);
  4. MMR, deduplicating parallel Hindi/English editions via `parallel_group_id`;
  5. parent-section expansion.
- **Tenancy and filtering:**
  - `org_id` is a tenant-flagged payload index; shared corpora use `org_id=public`.
  - Payload indexes on exam, taxonomy ids, language, licence, status, difficulty and year.
  - Licence and tenant filters are applied **inside** the retrieval function, never left to callers.
- **Storage and resilience:**
  - int8 quantization with rescoring: about 4× less RAM at near-identical accuracy.
  - One alias per embedding version, so re-embedding needs no downtime.
  - Nightly snapshots to S3, plus **Parquet copies of embeddings in S3**, so a rebuild never pays to re-embed.

### Valkey 8 ×2

- **`valkey-queue`:** `noeviction`, AOF every second. BullMQ queues split by resource class: `cpu-parse`, `llm-batch`, `llm-live`, `embed`, `chem`, `index`, `generate`, `verify`, `render`, `pool`, `eval`. Payloads are versioned, carry ids only, and include the trace context.
- **`valkey-cache`:** `allkeys-lru`. Holds:
  - caches for query embeddings, retrieval results, and exact-match LLM results for deterministic tasks;
  - a semantic cache for repeated concept Q&A;
  - rate-limit and quota counters;
  - Valkey Streams for resumable progress events.

### S3 / SeaweedFS

Buckets: `raw` (uploads), `derived` (page images, figure crops, transcripts), `exports` (PDF/DOCX), `embeddings` (Parquet per embedding version).

---

## 5. AI pipeline (inside the AI engine)

**5.1 Ingestion.** One BullMQ flow per file. Stages are idempotent with deterministic job ids, and state lives in `pipeline_runs`. CPU-heavy work (PyMuPDF, RDKit, DECIMER, sympy) runs in a process pool so worker locks never stall.

1. **Triage:** text layer? which fonts? how much math or diagram content?
2. **Legacy Hindi fonts:**
   - detect them from font names and the character mix;
   - convert with mapping tables;
   - accept a conversion only if it agrees with a vision-OCR read of sampled pages, otherwise fall back to OCR.
3. **Normalization:** the shared Devanagari normalizer, everywhere.
4. **Born-digital pages:** extract directly.
5. **Scanned, math or diagram pages:** vision-LLM transcription to Markdown + LaTeX + `mhchem` + tables, with figure bounding boxes, via the **Batch API (50% off)**.
   - Batches are submitted, then polled by a scheduler; batch ids are kept in `llm_batches`, so no worker waits up to 24 h.
   - The model per page type comes from the bake-off: vision LLMs vs PaddleOCR-VL, Sarvam Vision and Mathpix.
6. **Figures:** cropped and captioned. Chemistry structures go to SMILES (DECIMER/MolScribe) and are re-rendered with RDKit.
7. **Quality gates:** KaTeX parse, a render-back image comparison on low-confidence pages, Devanagari validity, agreement with the text layer. Failures go to the **OCR review queue**.
8. **Question papers become item-bank records:**
   - Hindi and English versions are linked as one item.
   - Answer keys are matched by booklet set (A/B/C/D) + question number; the final key overrides the provisional one.
9. **Tagging and indexing:**
   - taxonomy auto-tagging (cheap model, Batch);
   - structure-aware chunks of 300–800 tokens (equations and question/options/solution groups never split);
   - per-chapter contextual headers;
   - embeddings, then the Qdrant upsert and a Parquet copy.
10. **Videos** (trailing track): ASR bake-off (faster-whisper vs IndicConformer vs hosted Indic ASR), board-frame OCR, timestamped topic segments.

**5.2 Paper generation** (BullMQ `generate` job; streamed through SSE):

1. **PaperSpec:** an editable card the teacher confirms.
2. **Slot plan:** deterministic, from the spec plus the exam blueprint.
3. **Pool first:** pre-verified items this student batch hasn't seen.
4. **Retrieval per remaining slot.**
5. **Parallel section generation** on cache-stable prompts: the first call warms the cache, then the rest fan out.
6. **Fast checks in parallel, then the item streams in:** grounding, sympy and lint run together.
7. **Blind re-solve by the other provider runs in the background;** each item's badge updates when it finishes.
8. **Assembly:** balanced answer positions, booklet sets A/B/C/D with keys, solutions booklet.

**5.3 Verifier chain** (results are stored and shown to reviewers):

| Check               | How                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Citation integrity  | In code: every cited chunk id must be in that slot's evidence                                                                                   |
| Grounding           | Judge model: is every fact supported by the cited chunks?                                                                                       |
| Answer key          | Blind re-solve by the **other provider** + sympy for numerical answers                                                                          |
| Lint                | Single correct answer, distractor quality, no answer leakage, exam conventions, Hindi grammar                                                   |
| Format              | KaTeX, `mhchem`, Devanagari, figure references                                                                                                  |
| Novelty / copyright | Embedding + MinHash against the item bank; verbatim n-gram check against all sources. PYQ reuse only on explicit opt-in.                        |
| Diagram feasibility | Items needing a figure use an existing asset or validated generated code (circuitikz/schemdraw, matplotlib, RDKit); otherwise "not generatable" |

**5.4 Chat editing:**

- The paper is a JSON document with stable item ids. The agent sees a compact outline and works through tools (`replace_item`, `patch_item`, `add_items`, `delete_items`, `reorder`, `adjust_difficulty`, `make_bilingual`, `rebalance_answers`, `search_content`).
- **Only the affected items are regenerated and re-verified.** NestJS commits each change as a version, with diff and undo.
- Conversations are **append-only**, which keeps caches warm and Claude's earlier reasoning valid.
- Switching models mid-chat rebuilds the context from a provider-neutral transcript.

**5.5 Bilingual quality:**

- Hindi and English are generated together in one item, guided by the center's glossary (mined from its bilingual papers, backed by CSTT standard terms) and its Hindi exemplars.
- A back-translation check confirms both versions ask the same thing.
- The authoritative language is configurable per exam (Hindi for RPSC/REET).

---

## 6. LLM gateway, cost and speed

**Gateway (Python only)**

- Thin adapters over the official `anthropic` SDK (Claude Platform on AWS client) and the `openai` SDK.
- **Claude specifics:**
  - adaptive thinking with **effort set per task** (Opus 5.5 defaults to `medium` and can't disable thinking);
  - structured outputs;
  - no sampling parameters, no forced `tool_choice`;
  - `fallbacks: "default"` for refusals.
- **GPT specifics:** Responses API, strict JSON schema, `reasoning.effort`, `prompt_cache_key`.
- **Schemas** are generated per provider from `contracts`, because the two providers accept different JSON-schema subsets.
- **Admin-editable configuration:** a model registry (prices incl. cache read/write and long-context tiers, capabilities) and a task routing table (`task → model, effort, max_tokens, fallback`). The top model handles anything teachers see or that decides correctness; Haiku 5.5 / GPT-6 Luna handle bulk chores.

**Speed and savings, with no quality trade-off:**

1. **Cache-stable prompt layers:**
   `[tools][frozen system rules][style pack: blueprint + exemplars + glossary][evidence pinned per session][append-only turns]`.
   - Cache reads cost 5% of the input price on Opus 5.5 and 5–10% on GPT.
   - TTL: 5 minutes for generation bursts, 1 hour for editing sessions.
2. **Batch APIs (50% off, stacks with caching)** for OCR, tagging, headers, pool generation and evals.
3. **Demand-driven pre-verified pool:** common papers are assembled in seconds.
4. **Edits regenerate only the changed items;** the agent sees an outline rather than the full paper.
5. **Valkey caches:** embeddings, retrieval results, exact-match deterministic results.
6. **Streaming never waits on the slow check:** the background blind re-solve updates badges later.
7. **Effort tuned per task by evals** before any model-tier change.
8. **Budgets and visibility:** per-teacher/org budgets (soft, then hard), pre-flight cost estimate, cost dashboard. A CI check asserts that caching actually hits.

---

## 7. Local development environment

Docker infrastructure is bound to **127.0.0.1 only**. It uses ports **38000–38190**, which nothing on this machine uses. Already taken here: 5000, 5432, 6379, 7000, 15432, 16379, 17880–17881, 19000–19001, 19997, 24000, 25432, 29000–29001, 55432–55433, plus macOS's temporary-port range 49152–65535.

| Service                                                                  | Host port     | Runs as                                                 |
| ------------------------------------------------------------------------ | ------------- | ------------------------------------------------------- |
| **App entry: Caddy** (`/` → web, `/api/*` → api; same origin, as on AWS) | **38000**     | container `vidyam-caddy`                                |
| web (Next.js 16)                                                         | 38100         | host, via `pnpm dev`                                    |
| api (NestJS) + Bull Board `/api/admin/queues`                            | 38110         | host                                                    |
| ai (FastAPI internal)                                                    | 38120         | host (workers run from the same project)                |
| PostgreSQL 17                                                            | 38130         | container `vidyam-postgres`                             |
| Qdrant 1.20 HTTP / gRPC                                                  | 38140 / 38141 | container `vidyam-qdrant`                               |
| valkey-queue / valkey-cache                                              | 38150 / 38151 | containers `vidyam-valkey-queue`, `vidyam-valkey-cache` |
| SeaweedFS S3 API / admin UI                                              | 38160 / 38161 | container `vidyam-seaweedfs`                            |
| render worker health                                                     | 38170         | host                                                    |
| Mailpit SMTP / UI (invites, password resets)                             | 38180 / 38181 | container `vidyam-mailpit`                              |
| Drizzle Studio                                                           | 38190         | host, on demand                                         |

- Compose project `vidyam`; volumes `vidyam_pg`, `vidyam_qdrant`, `vidyam_valkey_queue`, `vidyam_s3`.
- A `full` compose profile also runs the four apps as containers, for production-like testing.
- **Commands:**
  - `pnpm infra:up` / `pnpm infra:down`
  - `pnpm db:migrate`, `pnpm db:seed`
  - `pnpm dev` (turbo: web, api, ai, render, hot reload)
  - `pnpm test`, `pnpm test:integration`, `pnpm test:live` (opt-in, spends API money)
- Toolchain: Node 22 LTS, pnpm 10, Python 3.12 (uv).

---

## 8. AWS (after local is complete): cheapest setup that scales

| Component                | AWS                                                                        | Start size (Graviton) | ≈ / month         |
| ------------------------ | -------------------------------------------------------------------------- | --------------------- | ----------------- |
| Edge                     | CloudFront (path routing `/api/*` → ALB → api; `/*` → web) + WAF           |                       | ~$10–20           |
| web                      | ECS Fargate ARM                                                            | 0.25 vCPU / 0.5 GB    | ~$10              |
| api                      | ECS Fargate ARM                                                            | 0.5 vCPU / 1 GB × 2   | ~$30              |
| ai-api + ai-ingest       | ECS Fargate ARM; ingest on **Fargate Spot**, autoscaled on queue depth     | 1 vCPU / 3 GB         | ~$40–80           |
| ai-chem, render          | Fargate Spot, scale to zero                                                | on demand             | ~$5–10            |
| PostgreSQL               | RDS PostgreSQL 17 db.t4g.medium, PITR (Multi-AZ at go-live)                |                       | ~$65 (→ ~$130)    |
| Qdrant                   | EC2 r7g.large + gp3; snapshots to S3 (or Qdrant Cloud)                     | 16 GB RAM             | ~$95              |
| Valkey ×2                | ElastiCache for Valkey, node-based cache.t4g.micro ×2                      |                       | ~$20              |
| Storage                  | S3 (+ Glacier IR for processed video)                                      |                       | ~$20–100          |
| Network                  | **fck-nat on t4g.nano** instead of a NAT Gateway, plus S3 gateway endpoint |                       | ~$5 (saves ~$35+) |
| **Infrastructure total** |                                                                            |                       | **~$300–450**     |

- **GPU:** none is needed if the Voyage embedding/rerank API wins the bake-off. If self-hosted BGE-M3 wins:
  - add an EC2 g6 capacity provider for query-time embedding and rerank (≈$400–600/month);
  - run backfills on Spot.
- **LLM spend estimates** (the pilot measures the real figures):
  - one-time backfill: about $2–6k;
  - fresh 50-question bilingual paper on Opus 5.5: about $1.5–2.5;
  - pool-served papers and edits: cents.

---

## 9. Execution plan — 100 steps

### Phase 0 · Clean slate and foundations (1–12)

1. Delete the previous scaffold: `backend/`, `frontend/` (incl. `node_modules`), `docker-compose.yml`, `Makefile`, `.env.example`, `.gitignore`, `.github/`, `docs/`, `evals/`, `infra/`, `.git`.
2. Stop and remove the `vidyam-postgres-1` container and the `vidyam_pgdata` volume (frees port 55432).
3. `git init` on `main`; conventional commits; lefthook pre-commit (eslint/prettier + ruff).
4. Pin the toolchain: `.nvmrc` Node 22, `packageManager` pnpm 10, `.python-version` 3.12, turbo 2.11.x.
5. Turborepo: `pnpm-workspace.yaml`; `turbo.json` tasks (build, dev, lint, typecheck, test, test:integration, codegen, db:*), with `contracts#build` as a dependency of every app task.
6. Root `pyproject.toml` uv workspace (`apps/ai`) + root `uv.lock`; turbo Python workspace flag; Python tasks cached on lockfile + sources.
7. `packages/config`:
   - eslint flat config with clean-architecture import rules;
   - LLM provider SDKs banned in `api` and `web`;
   - prettier, tsconfig bases, ruff + pyright presets.
8. `infra/docker/compose.yml` with:
   - Postgres 17, Qdrant 1.20, valkey-queue (noeviction, AOF), valkey-cache (allkeys-lru), SeaweedFS, Mailpit, Caddy;
   - 381xx ports on 127.0.0.1, healthchecks, named volumes, a `full` profile.
9. Environment: `.env.example`, validated at startup by zod (TS) and pydantic-settings (Python). Secrets are never committed.
10. Root scripts (`infra:*`, `dev`, `db:*`, `test*`) + README quick start.
11. GitHub Actions: pnpm + uv install, turbo remote cache, lint, typecheck, unit tests, integration tests with service containers, codegen-staleness check.
12. ADRs 001–008: Turborepo + uv, clean architecture, service boundaries, data layer, BullMQ, auth, ports, LLM ownership.

### Phase 1 · Contracts, data, identity, skeletons (13–24)

13. `packages/contracts`: zod schemas for Question, PaperSpec, Slot, Paper JSON, ChatEvent, versioned job payloads, usage record. Exported as TS types + JSON Schema.
14. Codegen of JSON Schema → Pydantic into `apps/ai` (committed; CI fails if stale).
15. `packages/db`:
    - Drizzle schema for all tables in §4, first migration, `pg_trgm`;
    - RLS policies keyed on `app.org_id`;
    - Better Auth tables generated into the schema with UUID ids.
16. Python data access: SQLAlchemy Core tables generated from the migrated database (`sqlacodegen --generator tables`), plus a CI drift check against a freshly migrated database.
17. Seeds: org, super-admin, model registry + task routes, exams, taxonomy skeleton for the top 5 exams.
18. Qdrant bootstrap (idempotent):
    - collections, `dense`/`sparse` vectors, `lex`/`lex_roman` full-text indexes with BM25;
    - payload indexes, tenant index on `org_id`;
    - int8 quantization, versioned aliases.
19. Queue foundation:
    - BullMQ queue registry in `contracts`; Node 6.x + Python 3.x pinned;
    - **cross-language contract test** (Node produces a flow, Python consumes it);
    - Bull Board in the API.
20. S3 bootstrap: buckets, CORS for presigned uploads; lifecycle rules (AWS only).
21. NestJS skeleton:
    - Express adapter, 4-layer modules;
    - zod validation pipe, error mapping;
    - OpenAPI → `packages/api-client` codegen;
    - OpenTelemetry;
    - RLS session helper.
22. Better Auth via `@thallesp/nestjs-better-auth` (`bodyParser:false`):
    - email/password and invites (Mailpit locally);
    - organizations, roles (Super-admin, Admin, Reviewer/HoD, Teacher, Content operator);
    - `@OrgRoles` guards.
23. Next.js 16 skeleton:
    - Tailwind + shadcn/ui (`packages/ui`);
    - TanStack Query with a per-request QueryClient, server prefetch + `HydrationBoundary`;
    - cookie forwarding to the API, auth pages, role-aware layout, Hindi/English UI;
    - Caddy same-origin routing.
24. Python AI engine skeleton:
    - FastAPI internal app (service token);
    - BullMQ worker runner with a process pool for CPU work and deterministic job ids;
    - 4 layers, health endpoints;
    - images split into ai-api, ai-ingest and ai-chem.

### Phase 2 · Ingestion and knowledge (25–42)

25. Collect the pilot set with teachers: ~500 pages covering Kruti Dev PDFs, scans, bilingual RPSC/REET papers with separate keys, JEE math/chemistry; plus 20 hours of video.
26. Build the golden sets with teachers:
    - 200 retrieval queries (Hindi, English, Hinglish, cross-language, formula-heavy);
    - 200 items with known answers;
    - 30 generation briefs per exam family.
27. Library upload: presigned multipart upload; CSV/Excel manifest (exam, subject, class, book, year, licence, parallel edition); SHA-256 dedupe.
28. Ingestion flow on BullMQ with `pipeline_runs` state, a reconciler that re-enqueues lost work, and live progress in the Library UI.
29. PDF triage (PyMuPDF in the process pool): text layer, fonts, character features, page images to S3.
30. Devanagari module:
    - legacy-font detection and Kruti Dev/Chanakya/DevLys → Unicode;
    - the normalizer and ISO-15919 romanizer, shared by indexing and querying;
    - unit tests on real samples.
31. OCR bake-off harness on the pilot pages: vision LLMs (Claude/GPT) vs PaddleOCR-VL vs Sarvam Vision vs Mathpix. Scored on Hindi, math and tables, plus cost.
32. Vision-OCR stage via Batch: submit → scheduled poll → collect, batch ids in `llm_batches`; per-page-type model routing; figure bounding boxes.
33. Figures: crops and captions; chemistry to SMILES (DECIMER/MolScribe, in the ai-chem image) and RDKit re-render.
34. Quality gates (KaTeX, render-back comparison, Devanagari validity, text-layer agreement), then the OCR review queue.
35. OCR review UI: side-by-side original vs parsed; inline LaTeX/Hindi editing; approve.
36. Question-paper segmentation into item-bank records (structured outputs); Hindi/English variant linking.
37. Answer-key matching by set code A/B/C/D + question number; provisional vs final keys.
38. Taxonomy auto-tagging (cheap model, Batch) with a low-confidence review queue; taxonomy editor UI.
39. Glossary mining from aligned bilingual pairs + CSTT import; glossary admin UI.
40. Structure-aware chunking + per-chapter contextual headers (cached chapter context, Batch).
41. Licence flags enforced end to end (own / third-party / PYQ); `parallel_group_id` for Hindi/English editions.
42. Video pipeline (may trail): ASR bake-off, keyframe board OCR, timestamped topic segments.

### Phase 3 · Retrieval (43–50)

43. Embedding bake-off on the golden queries: Voyage current gen (API) vs self-hosted BGE-M3. Accuracy, latency and the GPU cost implication.
44. Keyword and rerank bake-off:
    - keyword: BM25 on `lex`/`lex_roman` vs BGE-M3 sparse vs both;
    - fusion: weighted RRF vs DBSF;
    - rerank: Voyage vs bge-reranker-v2-m3.
45. Embedding stage: Qdrant upsert (point id = chunk UUID, text in payload), Parquet copy to S3, embedding-version alias flip.
46. Query understanding: structured filters + bilingual/transliterated sub-queries (cheap model), run through the same normalizer.
47. Retrieval function:
    - one Qdrant Query API call (prefetch dense + BM25 → fusion) inside the tenant and licence filters;
    - cross-encoder rerank, MMR with parallel-edition dedupe, parent expansion.
48. Coverage sampling per blueprint slot (topic × type × difficulty).
49. `valkey-cache` caches for query embeddings and retrieval results, invalidated by index version.
50. Retrieval eval runner in CI. Target: recall@20 ≥ 0.9 across all query types.

### Phase 4 · LLM gateway and prompts (51–58)

51. Provider adapters (Claude Platform on AWS, OpenAI) following each provider's current API rules (§6).
52. Model registry + task routing from Postgres; per-chat teacher override; cross-provider routing for the blind re-solve.
53. Cache-stable prompt layout builder; deterministic serialization; TTL ordering checks.
54. Per-provider strict structured-output schemas generated from `contracts`.
55. Batch runner for both providers: submit, scheduled poll, collect by custom id, retry failures.
56. Usage ledger + cost calculator (cache read/write tiers, long-context tiers, batch discount); spend counters in `valkey-cache` for quotas.
57. Prompt library (`packages/prompts`), versioned per model family; synced to Langfuse with copyrighted text masked; prompt version recorded on every call.
58. Tests: byte-identical prompts for identical inputs (CI); live cache-hit test on both providers (opt-in).

### Phase 5 · Generation and verification (59–70)

59. PaperSpec extraction + editable spec card.
60. Exam blueprints for the top 5 exams (sections, marks, negative marking, duration) + blueprint editor.
61. Slot planner (deterministic) + pool lookup with exposure filtering.
62. `generate` job:
    - parallel cache-warm section generation;
    - `insufficient_evidence` handling;
    - progress via Valkey Streams → NestJS SSE (heartbeat, `Last-Event-ID` resume);
    - survives a closed tab.
63. Citation-integrity + grounding verifiers, run in parallel before an item streams in.
64. Sympy numerical checker (inline) + cross-provider blind re-solve (background, updates item badges).
65. Item lint + format verifiers (KaTeX, mhchem, Devanagari, figure references).
66. Novelty/copyright checker (embeddings + MinHash + verbatim n-grams against all sources).
67. Bilingual generation with the glossary + back-translation consistency check.
68. Diagram policy: reuse assets or validated generated code; other items marked "not generatable".
69. Assembly: numbering, balanced answer positions, booklet sets A/B/C/D with keys, solutions booklet.
70. Auto-regenerate failed items up to N times, then flag with reasons for review.

### Phase 6 · Studio and chat editing (71–80)

71. Studio layout: chat panel + paper canvas + version sidebar (TanStack Query + SSE client with resume).
72. Canvas editor: TipTap + KaTeX rendering + MathLive input + Hindi typing support.
73. Live streaming of verified items into the canvas; progress timeline; badges update when the background re-solve finishes.
74. Editor agent (AI engine): outline context, item tools, append-only conversation; chat turns streamed over internal HTTP.
75. Document versioning in NestJS: ops log, diff view, undo/redo, per-item history.
76. Model picker per chat (admin-allowed list); a mid-chat switch rebuilds context from the provider-neutral transcript.
77. More content templates: worksheet/DPP, chapter notes, revision sheet, solutions, flashcards, lesson plan.
78. Question bank UI: TanStack Table search and filter, approve, edit, merge duplicates, usage/exposure history.
79. Student batches + exposure tracking UI.
80. Feedback capture (ratings, edit diffs, rejection reasons) feeding exemplars and eval cases.

### Phase 7 · Export, review, admin (81–88)

81. `packages/paper-renderer`: paper JSON → HTML (KaTeX, Devanagari fonts, RPSC-style bilingual layouts, branding), shared by the web preview and PDF export.
82. Render worker: Playwright PDF; Pandoc DOCX with Word equations and embedded fonts; rasterized fallback for `\ce{}`.
83. Kruti Dev 010 DOCX export (Unicode → Kruti Dev) for local presses.
84. Review workflow: draft → in review → approved → published; comments; flagged-item queue; audit log.
85. Admin: users/roles, model registry, task routing, provider keys (Secrets Manager on AWS, `.env` locally).
86. Admin: prompt templates (versioned, A/B), content templates, blueprints, taxonomy, glossary.
87. Admin: quotas and budgets + cost dashboard (by task, model, provider, teacher; cache-hit rate; cost per paper).
88. Scheduled jobs (BullMQ job schedulers): demand-driven pool top-up via Batch, nightly evals, Qdrant snapshots + Parquet exports.

### Phase 8 · Quality, performance, security (89–94)

89. Full eval suite as a CI gate for prompt/model/route changes. Targets:
    - answer-key accuracy ≥ 99.5%;
    - grounding ≥ 99%;
    - "accept without edits" ≥ 85%.
90. Effort sweep per task on the evals (lower effort on the top model before any tier change).
91. k6 load test with 50 concurrent teachers. Targets:
    - first item visible < 5 s;
    - pool-backed 100-question paper < 15 s;
    - fresh 50-question paper ~60–90 s.
92. Security:
    - RBAC + RLS tenant-isolation tests;
    - prompt-injection tests on uploaded content;
    - rate limits;
    - dependency and secret scanning.
93. Observability: OpenTelemetry across web → api → BullMQ → ai → providers (trace context in job data); Langfuse; alerts on errors, queue lag, cache-hit drop and budget burn.
94. Backup and restore drill: Postgres PITR, Qdrant snapshot restore, rebuild from Parquet, S3 versioning.

### Phase 9 · AWS and go-live (95–100)

95. CDK stacks:
    - network (VPC, fck-nat, S3 endpoint);
    - data (RDS, 2× ElastiCache Valkey, Qdrant EC2, S3);
    - compute (ECS services, Fargate Spot workers, queue-depth autoscaling, optional g6 capacity provider);
    - edge (CloudFront path routing, WAF).
96. Multi-stage ARM64 images (`turbo prune` for Node apps, `uv sync --frozen --package` for Python) + CI/CD to staging on merge to `main`.
97. Staging: pilot backfill; rerun the evals and load tests on AWS.
98. Production backfill of the full library via the Batch APIs, with cost tracked against the estimate.
99. Teacher UAT: 5 teachers × 1 week; fix list; go/no-go on the "accept without edits" rate.
100.  Go-live: Multi-AZ RDS, runbooks, alerts, monthly cost review, feedback-loop schedule (exemplar refresh, embedding/reranker fine-tunes).

**Timeline** (3–5 engineers):

| Phases | Weeks |
| ------ | ----- |
| 0–1    | 1–4   |
| 2      | 5–9   |
| 3–4    | 10–12 |
| 5      | 13–15 |
| 6      | 16–18 |
| 7      | 19–20 |
| 8–9    | 21–24 |

---

## 10. Verification

- **Local stack:**
  - `pnpm infra:up` brings every container to healthy on its 381xx port;
  - `pnpm dev` serves the app at `http://localhost:38000`;
  - `/api/health` reports Postgres, Qdrant, both Valkeys, S3 and the AI engine as reachable.
- **Contracts and schema:** the codegen-staleness and Drizzle↔Python drift checks pass in CI. The Node→Python BullMQ contract test passes.
- **Ingestion:** with pilot files,
  - Kruti Dev converts to correct Unicode (matra and reph spot-checks);
  - a scanned JEE page has correct LaTeX (render-back);
  - an RPSC paper becomes linked bilingual items with answers matched across sets A–D.
- **Retrieval:** recall@20 ≥ 0.9, including Hinglish and cross-language queries.
- **Generation:** briefs run on Claude and on GPT, then:
  - rubric scores;
  - answer-key accuracy ≥ 99.5%;
  - zero ungrounded items in a 100-item teacher audit.
- **Caching:** the same request twice shows cache reads > 0 on the second, on both providers.
- **Chat edit:** "replace Q5 with a harder rotational-dynamics question" changes only Q5 (version diff), the new item passes verification, and undo restores it. Closing the tab during generation and reopening resumes the stream.
- **Export:** PDF, DOCX and Kruti Dev DOCX of a bilingual paper render Devanagari, equations, chemistry, figures and per-set keys correctly.
- **Load and security:** k6 targets met; RBAC + RLS isolation tests pass.
- **UAT:** teacher acceptance decides go-live.

## Risks and mitigations

- **Poor scans and legacy fonts:** cross-checked conversion, OCR fallback, review queue; error rates measured in the pilot.
- **Polyglot complexity:**
  - one contracts package with committed codegen;
  - one schema owner (Drizzle) with a drift check;
  - one LLM owner (AI engine);
  - a cross-language queue contract test;
  - turbo runs everything.
- **Experimental Turborepo Python support:** turbo version pinned. If the flag misbehaves, the fallback is plain `package.json` wrappers around `uv run`.
- **Hindi keyword search:** own normalizer + romanized field; the method is chosen by eval, not assumption.
- **Diagrams:** reuse figure assets or validated generated code; never AI-painted images in exam papers.
- **Copyright:** licence flags, n-gram checks against all sources, PYQ reuse only on opt-in.
- **Provider and model churn:** model ids and prices are configuration; eval gate before any switch; prompts versioned per model family.
