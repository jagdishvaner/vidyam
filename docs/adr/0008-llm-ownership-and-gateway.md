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
