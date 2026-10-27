# Vidyam — Master Plan v3: platform first, keys next, content last

> **Approved 2026-10-27.** It replaces [Master Plan v2](master-plan-v2.md), which is kept for its reasoning; the
> ADRs record what changed between them. Changes made during implementation are recorded as ADRs, not by editing
> this text:
>
> - Chat turns stream from the AI engine through the API, and cards are built by code. See ADR 0015.
> - Qwen3-Embedding-4B and Qwen3-Reranker-4B, self-hosted, replace the Voyage / BGE-M3 bake-off. The dense
>   vector is named `dense`; the model and its dimensions are in the collection name
>   (`chunks_v2_qwen3_embedding_4b_2560`) behind the `chunks` alias. See ADR 0016.
> - The API runs a Temporal worker on the `api` queue and stays the only writer of chat and document state. See
>   ADR 0017.
> - Removing or retagging content reaches Qdrant through an outbox. See ADR 0018.

## Context

The owner found the recent work hard to follow and out of order:

- a library page and an ingest command were built before the core product;
- there is still no chat, no settings and no admin panel.

v3 puts the work in the order they asked for:

1. **Finish the whole platform first.** That means every screen, the backends and the database: a dashboard, a ChatGPT-style chat with history, settings, and an admin panel.
2. **Adding keys must be enough.** Supplying an **OpenAI key and a Claude (Anthropic) key** should make the full pipeline work end to end.
3. **Content is uploaded last**, with **all metadata captured at upload**, so nothing ever has to be uploaded twice.
4. **Then only tuning remains**: prompts, routes and evaluations.

Scale:

- about 20 teachers per subject, roughly **100–200 staff users**;
- students never use this platform;
- thousands of pages of books and notes, and hundreds of question booklets;
- Hindi and English, much of it Kruti Dev, some scanned.

**Decisions made with the owner (2026-10-27):**

- Fixed roles plus subject assignment (no custom roles).
- The chat creates **question papers, worksheets and practice sets, notes and revision material**, and answers **doubts** with citations.
- All exam families need syllabi and paper patterns:
  - RPSC 1st & 2nd Grade;
  - REET;
  - JEE / NEET;
  - school boards, UPSC and SSC.
- **No approval step** before export. Review stays optional and can be switched on later per subject.
- Library, Question bank and Review pages stay as they are (low priority).
- **Embeddings and reranking (owner's choice):**
  - **Qwen3-Embedding-4B** for vectors: Apache-2.0, 100+ languages, 32K context, up to 2,560 dimensions, 69.45 on the multilingual MTEB benchmark;
  - **Qwen3-Reranker-4B** to re-rank results;
  - both are self-hosted, so no third API key. Serving is in §8.

**Recommended decision, stated here so the owner can overrule it at approval:**

- **Paper sourcing:** question bank first, generate the rest; a teacher can choose "fresh only".

---

## 1. Where we are (inventory)

| Area                                                                                                                                                                                                                    | Status                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Monorepo, CI, Docker (Postgres, Qdrant, Valkey cache, SeaweedFS, Temporal, Caddy), container images                                                                                                                     | ✅ built                  |
| Auth: logins, roles (superadmin, admin, reviewer, teacher, content operator), admin-created members, password reset, removal                                                                                            | ✅ built                  |
| DB schema: sources, pages, chunks; exams, taxonomy, syllabus, blueprints, glossary; questions bank; documents, versions; chat sessions & messages; LLM models, routes, prompts, ledger, batches, quotas; audit log; RLS | ✅ built (gaps in §4)     |
| Contracts: PaperSpec, Slot, PaperDocument, Question, events, library, workflows                                                                                                                                         | ✅ built (v2 needed, §4)  |
| Ingestion v1 (no keys): PDF/DOCX/TXT, Kruti Dev → Unicode, quality gates, chunking; `pnpm ingest`                                                                                                                       | ✅ built                  |
| Web: login, dashboard, members, library (+ file detail), EN/HI, theme                                                                                                                                                   | ✅ built                  |
| Qdrant collections bootstrapped (dense int8 + sparse + BM25 `lex`/`lex_roman`)                                                                                                                                          | 🟡 empty: nothing indexed |
| Admin panel (beyond members), settings page                                                                                                                                                                             | ⬜ not built              |
| Chat backend + UI (history, streaming, clarification cards)                                                                                                                                                             | ⬜ not built              |
| LLM gateway (Anthropic/OpenAI adapters, routing, caching, batch, ledger, quotas)                                                                                                                                        | ⬜ not built              |
| Embeddings, Qdrant indexing, hybrid retrieval, tagging to syllabus, question segmentation, OCR                                                                                                                          | ⬜ not built              |
| Generation + verification workflows, document canvas, edit-by-chat, export (PDF/DOCX/Kruti Dev DOCX)                                                                                                                    | ⬜ not built              |
| Usage/budget dashboards, observability, evals                                                                                                                                                                           | ⬜ not built              |

**Defects to fix first:**

- **(a)** Removing a file deletes its Postgres rows and S3 original, but nothing removes its Qdrant points, so the text would stay searchable once indexing exists. Fix with an outbox table that the AI engine applies to Qdrant.
- **(b)** `PIPELINE_STAGES` puts `tagged` before `chunked`.
- **(c)** Comments still mention Voyage, which would mean a third key.
- **(d)** The Qdrant collections were created for 1,024-dimension dense vectors plus a BGE-M3 sparse slot. They need recreating for Qwen3 (2,560 dimensions, no sparse slot). They are empty, so this is a quick alias switch.

---

## 2. The product: screens

Navigation for everyone: **Dashboard · Chat · Library · Question bank · Review · Settings**. Admins also see **Admin**.

- **Dashboard.**
  - Teachers see recent chats and documents, quick actions ("New paper", "Ask a doubt") and their AI usage against budget.
  - Admins also see the center's cost by teacher, task and model, content coverage by subject and chapter, the OCR and tagging backlog, and system health.
- **Chat** (ChatGPT-style).
  - **Left sidebar:** a **New chat** button, then the history list, searchable, with pin, rename and archive.
  - **Main area:** the conversation, a model picker (from the admin's allowed list) and an attach button (later).
  - **When a document exists:** a **canvas panel** opens on the right with a live paper preview, item badges, manual edit, version history with undo, and export buttons.
  - **Message types:**
    - text with citations (book, page);
    - **clarification cards** (selections);
    - a spec review with a cost and time estimate and a **Confirm** button;
    - live progress;
    - edit summaries with Undo.
- **Settings:**
  - profile, and changing your own password;
  - UI language and default content language (Hindi, English or bilingual);
  - default AI model, default exam and subjects.
- **Admin:**
  1. **Staff:** add, edit or remove; role; subjects (and head-of-department flag); monthly AI budget; reset password. Replaces today's Members page.
  2. **Roles & permissions:** a read-only matrix of the fixed roles.
  3. **Exams & syllabus:** exam papers (e.g. RPSC 2nd Grade Paper-II, REET Level 2); a syllabus tree editor (subject → unit → chapter → topic → subtopic, Hindi and English names, aliases, weightage); import from CSV/JSON.
  4. **Paper patterns (blueprints):** sections, question types, counts, marks, negative marking, "attempt any N", duration, instructions in Hindi and English, default difficulty mix.
  5. **Content:** library management; the upload screen comes in phase C; **Run OCR/tagging backlog** with a cost estimate first.
  6. **AI models & routing:** enable models, choose which ones teachers may pick, task → model/effort routes, and provider key status.
  7. **Prompts:** versioned templates per model family.
  8. **Usage & budgets:** costs from the usage ledger; budgets per center and per teacher.
  9. **Center profile & branding:** name in Hindi and English, logo, and the header, footer and default instructions used in exports.
  10. **Audit log.**
  11. **System health:** the existing view.

Permissions use the fixed roles:

| Role                        | Can                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------- |
| **Admin**                   | everything                                                                              |
| **Reviewer / Head of Dept** | teacher rights, plus approving questions into the bank and seeing their subjects' usage |
| **Teacher**                 | chat, documents, export, library read                                                   |
| **Content operator**        | library management, uploads, the OCR backlog                                            |

A teacher's subjects are the **default scope** for generation and content (soft), not a hard wall.

---

## 3. Architecture (boundaries unchanged, two additions)

```
Browser ──► Caddy/CloudFront ──► Next.js (screens)      /api/* ──► NestJS API
                                                            │ auth, RBAC, chat & document state, quotas, SSE
                                                            │ + Temporal worker on queue "api" (commits versions/messages)
                    chat turn (internal HTTP stream) ───────┼──► Python AI engine (FastAPI)
                    long jobs (Temporal workflows) ─────────┤      LLM gateway · retrieval · chat agent
                                                            │    + Temporal workers: ai, ai-cpu, ai-llm
                                                            │      ingestion · indexing · generation · verification
                                                            └──► Node render worker (queue "render"): PDF/DOCX/Kruti Dev DOCX
Postgres (truth, RLS) · Qdrant (vectors) · Valkey (cache, rate limits, SSE streams) · S3 (originals, page images, exports, Parquet)
Model server (AI engine only): Qwen3-Embedding-4B  /v1/embeddings  ·  Qwen3-Reranker-4B  /v1/rerank
```

- The **API never calls an LLM**. The **AI engine never writes chat or document state**: workflow activities that commit results run in the API's own Temporal worker on the `api` queue. That keeps NestJS the single writer, with retries handled by Temporal. This is a polyglot step, so spike it early.
- **Chat turns** stream API → AI engine over internal HTTP for the fastest first token. The API relays the stream as SSE through a Valkey stream, so a dropped connection resumes and a closed tab doesn't kill the turn.
- **LLM keys** are read only by the AI engine (Python).

---

## 4. Data model and contracts to add (phase A0)

**Identity and admin**

- `member_settings`: UI language, content language, default model, default exam.
- `member_subjects`: user ↔ subject node, plus an optional exam and an `isHead` flag.
- `org_settings`: branding and AI policy.
- Extend the access-control statements: `chat:use`, `document:export`, `question:approve`, `syllabus:manage`, `ai:manage`, `budget:manage`, `audit:read`.

**Content (upload metadata, so nothing is ever re-uploaded)**

- `sources` gains typed columns:
  - `title`, `subjectNodeId`, `examCodes[]`, `classLevel`, `year`;
  - `setCode`, `answerKeyForSourceId`, `pageOffset`, `fontHint`, `manifestBatchId`.

  The raw manifest row is kept in `meta.manifest`.

- `ingest_batches` (one per manifest) and `source_sections` (page ranges → chapter node, with origin and confidence).
- `pages` gains `pageLabel` (the printed page number) and `extractorVersion`.
- `chunks` gains `sectionId`, `headingPath`, `kind` (prose, question, solution, definition, table), `contentHash`, `chunkerVersion`, `embeddingVersionId` and `indexedAt`.
- `chunk_tags` and `question_tags` gain `method`, `taggerVersion` and `isPrimary`.
- `index_outbox`: deletes and payload updates waiting to be applied to Qdrant.

**Knowledge**

- `taxonomy_nodes` gains a `code` (a stable slug that manifests and imports use) and `isActive`.
- `exams` gains `family` and `paperCode`.
- A `Blueprint` contract for `exam_blueprints.spec`.
- `coverage_stats` view: chunk and question counts per syllabus node, question type and difficulty, used by the cards.

**Chat and documents**

- A `ChatBlock` contract with these block types:
  - text, citations, clarification card, card response, spec review;
  - progress, document reference, edit summary;
  - notice, error.
- `chat_sessions` gains `draftSpec`, `status`, `pinned` and `archivedAt`.
- `chat_turns`: idempotent client turn id, status and stream key.
- `generation_runs`, and `document_exports` (format, variant, set code, S3 key).
- `documents` gains `examId` and `subjectNodeId`.
- `TaskSpec` covers a paper, worksheet, notes or revision material. PaperSpec becomes one variant of it.
- `PaperDocument` v2: slots with state; sets A–D with their own keys.
- `EditOp` with `baseVersion`.

**LLM**

- A `stub` provider (realistic, zero cost, used until keys exist).
- An `LlmTask` enum.
- `llm_calls` gains `turnId` and `workflowId`, and embedding calls are logged in the same ledger.

**Repo docs:** update `docs/master-plan.md` to v3, with ADRs for the chat architecture, the embeddings choice, the API Temporal worker and the outbox.

---

## 5. Content → vector DB (ingestion v2)

### Manifest

Folder-level defaults with per-file overrides, as a CSV or spreadsheet template I provide.

|                              | Fields                                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Required                     | kind, licence (own / third_party / pyq), subject code, language (hi/en/bilingual), exam codes                                                   |
| Required for question papers | paper code, year, set code (A–D), date/shift                                                                                                    |
| Required for answer keys     | which paper, set code, provisional or final                                                                                                     |
| Required for books           | title                                                                                                                                           |
| Optional, valuable           | chapter code (single-chapter notes), sections [{pages, chapter}], class, parallel edition (Hindi ↔ English), page offset, author, edition, tags |
| Derived automatically        | hash, pages, script, fonts, scan flags, page labels, sections, questions, chunks, tags, vectors                                                 |

### Pipeline (each stage idempotent, versioned, re-runnable from the layer below)

1. Validate the manifest against syllabus and exam codes.
2. Store the original and typed metadata. _(built)_
3. Extract text. _(built)_ Also render every page to an image in S3, for OCR, figures and citation previews.
4. OCR backlog: a vision LLM through the Batch API, at half price. Admin-triggered, after a cost estimate.
5. Find sections: manifest page ranges, then the table of contents, then headings (font size/bold from PDFium, plus patterns like अध्याय/Chapter/इकाई). Results go into `source_sections`.
6. For papers, split into questions:
   - an LLM with a fixed output schema writes `questions` and `pyq_refs`;
   - Hindi and English versions are linked;
   - answer keys are matched by set code and question number.
7. Chunk. _(built)_ Add the heading path, which is used as the context header with no LLM call, and the chunk kind.
8. Tag, rules first:
   - a manifest chapter applies to the whole file;
   - a section mapped to a chapter tags its chunks with confidence 1.0;
   - an LLM picks topic and subtopic **only among that chapter's children** (cheap model, Batch API);
   - confidence below 0.6 goes to a review queue.

   Tagging is what lets a teacher's chapter and topic picks work.

9. Embed with **Qwen3-Embedding-4B** over heading path plus text:
   - documents get no instruction prefix; queries get the task instruction (`Instruct: … Query: …`);
   - full 2,560-dimension vectors, stored in Qdrant with int8 quantization and rescoring;
   - Parquet copies of the vectors go to S3, so re-indexing never re-embeds.
10. Index into Qdrant, refresh `coverage_stats`, mark the source "Ready". The outbox applies deletions and tag changes.

### Qdrant point payload

- Vectors: one named dense vector `qwen3_4b` (2,560 dimensions, cosine, int8 quantization); keyword matching uses Qdrant's BM25 full-text indexes on `lex` and `lex_roman`.
- Fields: org_id, source_id, kind, licence, language, parallel_group_id, subject_id, primary_node_id, chunk_kind, pages and page_label, position, heading_path, text, lex, lex_roman, year, content_hash, embedding_version.
- `taxonomy_node_ids[]` holds the tags **plus all their ancestors**, so filtering by a chapter also finds topic-level chunks.
- The exam is worked out at query time through `exam_syllabus`; only past-paper questions store it.
- The `questions` collection adds qtype, difficulty, status, origin, has_figure and languages.

### Never re-upload

| Change                  | What runs                                                                  |
| ----------------------- | -------------------------------------------------------------------------- |
| Tags, status or removal | Outbox applies a payload update or delete                                  |
| Hindi normalizer        | Re-index from the Parquet copies                                           |
| New embedding model     | Re-embed from `chunks.text` into a new collection, then switch the alias   |
| Chunker                 | Re-chunk from `pages`                                                      |
| Converter fix           | Re-extract from the S3 original, for pages with the old `extractorVersion` |

---

## 6. The chat: how a turn works

1. **The browser sends a turn:** `POST /api/chat/sessions/:id/turns` with a client turn id (so retries don't duplicate), carrying free text, a card submission or an action (confirm, cancel, undo).
2. **The API records it.** In one transaction it checks permissions and budget, then appends the message and the turn record. It then calls the AI engine with **ids only** and relays the engine's stream over SSE.
3. **The AI engine handles the turn:**
   - **card submissions and actions use no LLM call**; the values are merged into the draft spec in code;
   - free text uses one cheap-model call with a fixed output schema: `{intent, specDelta, mentions[]}`;
   - mentions (chapter or topic names, Hinglish included) are matched in code against syllabus aliases and their romanized forms.
4. **Intents:**
   - **create** (paper, worksheet/practice, notes/revision);
   - **ask** (a doubt or explanation);
   - **edit** (the open document);
   - **chat** (anything else).
5. **Asking clarifying questions.** The rules are in code:
   - missing or ambiguous required fields become at most **two cards**, asking only for what's missing:
     - **Scope:** exam and paper pattern, then a chapter → topic tree with available content counts;
     - **Shape:** question types × count × marks, negative marking, duration, difficulty mix (easy/medium/hard presets or sliders), language and layout, source (bank first / fresh / mix), student batch;
   - defaults come from the blueprint, the teacher's settings and their subjects;
   - long option lists such as the syllabus tree are fetched live by the web app, so counts stay current and stored messages stay small.
6. **Spec review card:**
   - the full summary;
   - availability, e.g. "12 verified questions in the bank for Rotational Motion; 18 will be generated";
   - an estimate of cost and time;
   - a **Confirm** button. **Only Confirm starts paid generation.**
7. **Generation:**
   - Confirm makes the API create the document, a generation run and a `document_ref` block, then start the `GeneratePaper` workflow;
   - progress streams to the chat and the canvas, where questions appear as they pass checks;
   - closing the tab doesn't stop it.
8. **Doubts:** understand the query, then hybrid search, rerank, and answer with **citations (book, page)**. If the evidence isn't in the center's material, the answer says so instead of guessing.
9. **Edit by chat:**
   - the agent sees a short outline of the paper (item id, type, topic, difficulty, first words) and edits through tools: replace_item, patch_item, add_items, delete_items, reorder, adjust_difficulty, make_bilingual, rebalance_answers, search_content;
   - it returns edit operations together with the version it started from;
   - the API applies them only if that is still the current version, saves a new version and shows a diff with **Undo**;
   - more than 5 regenerated questions moves the work to a workflow.
10. **Switching models mid-chat** rebuilds the context from the provider-neutral transcript. Each card answer also stores a plain-text version.

---

## 7. "Create a question paper" pipeline (worksheets and notes reuse it)

1. **Plan the slots** in code: blueprint × syllabus weightage × available content (`coverage_stats`).
2. **Fill from the question bank first.** Prefer approved questions, then verified pool questions. Skip anything this student batch has seen, anything used recently, and near-duplicates.
3. **Find evidence** for each (topic, question type) group:
   - filter by topic (ancestors included) and licence;
   - hybrid search: Qwen3 dense vectors plus Qdrant's BM25 over `lex`/`lex_roman` (Hindi-normalized and romanized), fused with weighted RRF;
   - rerank the top 50 with **Qwen3-Reranker-4B**, keep the results diverse, and don't reuse evidence within a paper;
   - include the neighbouring sections by position;
   - if nothing is found, mark the slot `insufficient_evidence` and never invent content.
4. **Generate** up to 5 questions per call with the top model (the teacher's choice: Claude Opus 5.5 or GPT-6 Astra):
   - every question cites its source chunks;
   - Hindi and English are written together using the glossary.
5. **Fast checks**, after which each question streams to the canvas:
   - in code: schema, citations, KaTeX/Devanagari, exactly one correct answer, novelty against the bank (MinHash plus embeddings);
   - a grounding check by a cheap model.
6. **Slow checks**, which update the question's badge when done:
   - the **other provider** re-solves the question without seeing the answer, with sympy for numeric answers;
   - the Hindi and English versions are solved separately to catch translation drift.
7. **Retry** a failed question twice, giving the model the reason, then flag it for the teacher.
8. **Assemble** in code:
   - numbering;
   - option shuffling that keeps "all/none of the above" in place;
   - balanced answer positions;
   - sets A–D with a key per set, and a solutions booklet.
9. **Answer key trust**, in order: the official key, then agreement between both providers, otherwise the question is flagged.

**Worksheets and practice sets** use the same pipeline with a lighter pattern.

**Notes and revision material:**

1. Outline from the syllabus subtree.
2. Retrieve evidence per subtopic.
3. Write each section with citations.
4. A grounding check.
5. Render.

**Saving money without losing quality:**

- **Layered prompt caching:**
  - the rules and exam "style pack" (conventions, about 8 exemplars, glossary) are cached for 1 hour and shared by every teacher on that exam;
  - topic evidence is cached for 5 minutes;
  - the first call goes out alone to warm the cache, then the rest fan out.
- **Batch API** (half price) for OCR, tagging, segmentation, evals and nightly pool top-ups. Never for interactive work.
- **Valkey caches** for query embeddings and retrieval results.
- **Budgets** per teacher.

Expected cost:

- a fresh 100-question bilingual paper: a few dollars;
- a paper filled mostly from the bank: cents.

---

## 8. LLM gateway: "add keys and it works"

- **Providers:** the Anthropic API (key) and OpenAI (key), plus the **stub**.
- **Routing** from `task_routes`, which are seeded with the real models:

  | Provider  | Models                                               |
  | --------- | ---------------------------------------------------- |
  | Anthropic | claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5 |
  | OpenAI    | gpt-6-astra, gpt-6.1-sol, gpt-6-luna                 |

  The teacher's model choice overrides the route for generation and editing.

- **Structured output:** schemas are generated per provider from contracts, with an offline compatibility test.
- **Behaviour:** streaming, retries and fallbacks, and the ledger and budget check on every call.
- **Batch runner:** a Temporal workflow with timers (submit, wait, collect).
- **When the stub is used:** in development when no key is set, or when `AI_STUB=1`.
  - It is realistic: it matches syllabus aliases, builds questions from evidence text, and streams with delays.
  - It writes ledger rows at zero cost.
  - **In production a missing key is a loud error.**
- **Adding keys:**
  1. Key status shows in Admin → AI models.
  2. A one-click smoke test makes one call per task, about $1.
  3. The OCR and tagging backlogs **never start by themselves**: an admin runs them after seeing the cost estimate.

### Embeddings and reranking: the Qwen3 model server

The AI engine talks to a **model server** over two HTTP APIs: OpenAI-compatible `/v1/embeddings` and Cohere/Jina-compatible `/v1/rerank`. That keeps the code identical everywhere; only the URL changes.

| Where                           | How the models run                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Local Mac** (Apple M5, 24 GB) | **llama.cpp `llama-server` natively on the Mac's GPU (Metal)**, with Q8_0 GGUF weights of both 4B models (about 9 GB of memory, ~9 GB download). Docker on macOS can't use the GPU, so these run on the host like `pnpm dev`. They use ports **38180** (embeddings) and **38181** (rerank), freed by Mailpit. `pnpm models:setup` installs llama.cpp through Homebrew and fetches the weights; `pnpm models:up` and `pnpm dev` start them. |
| **Docker `full` profile**       | A CPU llama.cpp container: correct but slow. Fine for the demo pack.                                                                                                                                                                                                                                                                                                                                                                       |
| **CI**                          | The same family at small size: **Qwen3-Embedding-0.6B / Qwen3-Reranker-0.6B** on CPU, so tests are fast. Unit tests use a deterministic stub.                                                                                                                                                                                                                                                                                              |
| **AWS**                         | **vLLM on one NVIDIA L4 GPU** (EC2 g6.xlarge, 24 GB), serving both models (bf16 or FP8). About **$590/month on-demand, ~$370 with a 1-year Savings Plan**. Bulk re-embedding can run on Spot.                                                                                                                                                                                                                                              |

- Query embeddings and rerank results are cached in Valkey.
- Each model version is recorded in `embedding_versions`, so a later model upgrade re-embeds from `chunks.text` into a new collection and switches the alias.

---

## 9. Build plan

### Phase A: complete platform, no keys needed (everything works with the stub)

**A0. Foundations**

1. Fix the defects (outbox, stage order, Voyage comments).
2. Migrations and contracts from §4.
3. Permission statements and the role matrix.
4. **Demo content pack**, synthetic and written by us:
   - a manifest and about 40 pages: one Kruti Dev file, one scan, one bilingual booklet with its key;
   - 200 questions;
   - a glossary, a syllabus subset and blueprints.

   It is both the test fixture and the first evaluation set.

**A1. Admin and settings**

5. The admin shell, and **Staff**: the members page moves here, with subjects, budget and head-of-department flag.
6. **Exams & syllabus**:
   - an import format plus a tree editor;
   - seed exam papers and syllabus trees for all chosen families from the official syllabi:
     - RPSC 1st & 2nd Grade;
     - REET Level 1 and Level 2;
     - JEE / NEET;
     - CBSE/RBSE classes 9–12, and UPSC/SSC.
7. **Paper patterns** (blueprint editor), seeded for each exam paper.
8. **Center profile & branding**, and AI policy.
9. **AI models & routing**, with key status.
10. **Prompts**: versioned, with a `packages/prompts` source.
11. **Usage & budgets**.
12. **Audit log**: written for every admin action, plus a viewer.
13. **Settings page**.

**A2. LLM gateway (Python)**

14. Anthropic and OpenAI adapters, stub, routing, ledger, budgets, caching layout, structured outputs and the Batch runner.
15. Tests: recorded provider responses, and schema compatibility.

**A3. Knowledge and retrieval**

16. Ingestion v2: manifest, page images, sections, heading paths, chunk kinds, extractor versions; the question-segmentation and tagging stages (rules now, LLM steps behind the gateway).
17. Qwen3 model server and embedding service:
    - `pnpm models:setup` / `models:up` (llama.cpp on Metal locally, a CPU container for Docker mode);
    - the embeddings and rerank client in the AI engine, with query instructions;
    - Qdrant collections v2 (2,560 dimensions), Parquet copies, embedding versions.
18. Hindi normalizer and Hinglish romanizer, shared by indexing and queries.
19. Indexing into Qdrant, plus the outbox consumer and `coverage_stats`.
20. Retrieval service:
    - filters;
    - hybrid fusion;
    - rerank the top 50 with Qwen3-Reranker-4B;
    - diversity, parallel-edition de-duplication and neighbour expansion;
    - caching.
21. Retrieval evaluation in CI: 50 queries on the demo pack, target recall@20 ≥ 0.9.

**A4. Chat**

22. Chat backend: sessions (create, rename, pin, archive, search), idempotent turns, and SSE that resumes after a disconnect.
23. Chat agent: intents, spec extraction, alias matching, cards, spec review with estimates, doubt answers with citations.
24. Chat UI: history sidebar, New chat, model picker, every message block, streaming, Hindi/English.

**A5. Generation, documents and export**

25. The API's Temporal worker on the `api` queue, a spike first.
26. GeneratePaper, worksheet and notes workflows: slots, bank-first filling, evidence, generation, fast and slow checks, retries, sets and keys, solutions.
27. Canvas: live slots, badges, manual edits, versions, diff, undo.
28. The edit-by-chat agent.
29. Render worker:
    - paper renderer (React → HTML with KaTeX and Devanagari);
    - PDF through Playwright, DOCX through Pandoc, and Kruti Dev DOCX;
    - export history and download buttons.

**A6. Dashboard and operations**

30. Teacher and admin dashboards.
31. OpenTelemetry tracing across web → API → Temporal → AI → providers, plus error alerts.

**Phase A is done when:**

- every screen works in both languages;
- a teacher can go: New chat → "RPSC 2nd grade science paper" → cards → confirm → a paper streams in → "make Q5 harder" → undo → export PDF/DOCX;
- doubts are answered from the demo pack;
- all of it runs on the stub, with end-to-end tests in CI.

### Phase B: add keys (1–2 days)

32. Add the OpenAI and Anthropic keys and run the live smoke test, about $1.
33. Switch OCR, tagging and segmentation to the real models. Record a first evaluation baseline on the demo pack. Do a first round of prompt tuning.

### Phase C: your content (last, as asked)

34. The manifest template, filled in with your help. Codes come from the syllabus screens.
35. **Sample batch** of 30–50 files, to find layout and font surprises early.
36. Full upload, through `pnpm ingest` from the developer chat first:
    - the OCR, tagging and segmentation backlogs run with cost estimates;
    - everything is indexed;
    - the question bank fills from your past papers.
37. Admin upload screen: drag and drop, a metadata form or manifest upload, and progress.

### Phase D: tuning and quality

38. Golden sets with teachers: real queries, and questions with known answers.
39. An evaluation runner in CI, with targets:
    - answer-key accuracy ≥ 99.5%;
    - grounding ≥ 99%;
    - "accepted without edits" ≥ 85%.
40. Prompt, route and effort tuning, and nightly pool top-ups through the Batch API.
41. Load test (about 30 papers generating at once), security tests (RLS, prompt injection), backup and restore drill.

### Phase E: AWS go-live

42. CDK stacks:
    - RDS Postgres, ElastiCache Valkey, Qdrant on EC2, S3;
    - a GPU node (g6.xlarge, NVIDIA L4) running vLLM for the Qwen3 embedding and rerank models;
    - ECS services for the API, AI, workers and render;
    - Temporal on ECS (or Temporal Cloud);
    - CloudFront and WAF;
    - the Temporal UI behind authentication.
43. Staging, teacher trial, go-live.

---

## 10. Verification

- **Every step:** lint, typecheck, unit tests, and integration tests against local infrastructure (RLS, the cross-language contract, Temporal workflows), plus browser tests for the screens it touches. All of it runs in both `pnpm dev` and Docker modes.
- **End of A:** the full chat → paper → edit → export test runs on the stub with the demo pack, in CI. Removing a file also removes it from Qdrant, via the outbox.
- **Retrieval evaluation:**
  - locally with Qwen3-Embedding-4B and Qwen3-Reranker-4B on Metal, targeting recall@20 ≥ 0.9 on the 50 demo queries, including Hindi, Hinglish and cross-language queries;
  - in CI with the 0.6B models, as a smoke check;
  - reranker latency for 50 candidates is measured on the M5.
- **B:** the smoke test passes for both providers. Caching shows cache reads on repeat calls. Ledger costs match each provider's dashboard.
- **C:** sample batch:
  - Kruti Dev text reads correctly;
  - booklets split into questions with keys matched across sets A–D;
  - chapter and topic tags are spot-checked.
- **D:** evaluation targets met; load and security tests pass.

## 11. Risks and mitigations

- **Booklet layouts** (two columns, Hindi and English side by side, options in grids): use the sample batch early; segmentation results go to a review queue.
- **Syllabus trees are human work on the critical path:** seed them from the official syllabi in A1 and let admins edit.
- **Node and Python Temporal activities working together:** a spike at the start of A5. Fallback: the AI engine calls internal API endpoints.
- **Claude and OpenAI accept different JSON Schema subsets:** generate schemas per provider and test them offline.
- **Hindi with math in DOCX and Kruti Dev DOCX:** keep a rasterized fallback for complex formulas.
- **Costs:** budgets on from day one, Batch for bulk work, nothing paid starting by itself.
- **Qwen3 4B models need a GPU.**
  - On AWS that is a standing ~$370–590/month for one L4 node.
  - Locally they share 24 GB with the Docker stack, so Q8_0 weights are used and memory is watched.
  - The reranker's latency budget is about 1–2 s for 50 candidates on the M5, under 1 s on an L4.
  - The Qwen3 reranker needs its specific prompt format (yes/no judgement). Verify it in step 17 against the reference implementation before relying on scores.

## 12. What we need from you, and when

- **Now (not blocking):** the official syllabus PDFs you use, one printed paper of yours (for the export layout), and if possible 30–50 sample files.
- **Phase B:** an OpenAI API key and a Claude (Anthropic) API key. Nothing more: the Qwen3 models are self-hosted.
- **Phase C:** the full content with the filled-in manifest.
