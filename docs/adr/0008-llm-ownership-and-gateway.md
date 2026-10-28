# 0008. Only the Python AI engine calls LLMs

- Status: Accepted
- Date: 2026-10-24

## Context

Claude and GPT must both be supported, switchable per task (admin) and per chat (teacher). Prompt caching only
pays off if prompts are assembled byte-identically in a fixed layer order. Cost tracking and Batch API handling
must be exact. Two gateway implementations (TypeScript and Python) would drift on exactly these details and
silently lose cache hits.

## Decision

- **One LLM gateway, in `apps/ai`.** It uses thin adapters over the official `anthropic` SDK (Claude Platform on
  AWS client) and `openai` SDK, not a lowest-common-denominator shim.
- **NestJS and Next.js never import provider, embedding or vector SDKs.**
  `packages/config/eslint/no-llm-sdks.mjs` enforces it.
- **Admin-editable configuration in Postgres:**
  - a model registry (provider, model id, prices incl. cache read/write and long-context tiers, capabilities);
  - a task routing table (`task → model, effort, max_tokens, fallback`).
- **Cache-stable prompt layers:**
  `[tools][frozen system rules][style pack][evidence pinned per session][append-only turns]`.
  - Cache breakpoints sit at the layer boundaries.
  - Nothing volatile goes in a cached layer.
  - Conversations are append-only.
- **Claude specifics:**
  - adaptive thinking, with effort set per task;
  - structured outputs;
  - no sampling parameters and no forced `tool_choice`;
  - `fallbacks: "default"`.
- **GPT specifics:** Responses API, strict JSON schema, `reasoning.effort`, `prompt_cache_key`.
- **Background work goes through the Batch APIs (50% off).** Answer keys are blind re-solved by the _other_
  provider.

## Consequences

- One place to tune caching, routing and spend; one usage ledger.
- The API depends on the AI engine for anything AI-related. Interactive chat streams from it over private HTTP;
  long work goes through BullMQ.

## Update 2026-10-28: as built (plan v3 steps 14–15)

- `LlmGateway` (`apps/ai/.../application/llm_gateway.py`) is the one entry point: route (center's own, else the
  platform default) → the teacher's model only for `chat_qa`, `generate`, `notes_write`, `edit_agent`, and only
  if the AI policy allows it → active prompt version (model family, else `any`) → budget check (center and
  teacher, IST month) → provider → usage ledger. Failed calls are recorded too, at zero cost.
- Fallback is the route's `fallback_model_id`, tried once after a retryable provider failure (rate limit,
  overload, outage), and for streams only before the first text. Claude's server-side `fallbacks` is not used
  yet.
- Built-in **stub model** when a provider has no key or `VIDYAM_AI_STUB=1`: schema-valid structured replies,
  per-task responders, streaming, file-backed batches, ledger rows filed under model `stub` at zero cost. With
  `VIDYAM_ENVIRONMENT=production` there is no stub and a missing key is an error.
- Structured-output schemas come from Pydantic contracts and are adapted per provider
  (`infrastructure/llm/schemas.py`); a unit test checks every contract against both providers' rules offline.
- Batches run through the `LlmBatch` Temporal workflow (ADR 0013 replaced BullMQ): submit in the caller's
  activity, poll on durable timers, then collect once into the ledger at half price.
