/**
 * Default model registry and task routes. After seeding, the database is the source of truth and admins edit
 * models, prices and routes in the Admin panel; re-seeding never overwrites their edits.
 *
 * Prices: USD per million tokens, checked 2026-10-24.
 * - Claude (Anthropic model table): Opus 5.5 $4/$20 (cache read $0.20); Sonnet 5.5 $2/$10 (cache read $0.20);
 *   Haiku 5.5 $0.10/$0.50 up to 100K-token prompts, $0.50/$2.50 above. Cache writes 1.25x input (5-minute TTL),
 *   2x input (1-hour TTL).
 * - GPT (developers.openai.com models page + prompt-caching guide): cache reads 0.05x input on GPT-6.1 Sol and
 *   0.1x on most others; writes 1.25x (default 30-minute TTL) and 2.5x (12-hour TTL), stored in the
 *   cache_write_5m / cache_write_1h slots.
 * Values marked UNVERIFIED use the general multiplier, not a published per-model figure.
 */
import { schema, type Database } from "../index.js";

const ALL_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

type ModelRow = typeof schema.llmModels.$inferInsert;
type RouteRow = typeof schema.taskRoutes.$inferInsert;

export const DEFAULT_MODELS: ModelRow[] = [
  {
    id: "claude-opus-5-5",
    provider: "anthropic",
    apiModel: "claude-opus-5-5",
    displayName: "Claude Opus 5.5",
    prices: { input: "4", output: "20", cache_read: "0.20", cache_write_5m: "5", cache_write_1h: "8" },
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    // fallbacks "default" works on the Claude API and Claude Platform on AWS, not inside Batches.
    capabilities: {
      vision: true,
      batch: true,
      structuredOutput: true,
      thinking: "adaptive",
      effortLevels: ALL_EFFORTS,
      serverFallback: true,
    },
    teacherSelectable: true,
  },
  {
    id: "claude-sonnet-5-5",
    provider: "anthropic",
    apiModel: "claude-sonnet-5-5",
    displayName: "Claude Sonnet 5.5",
    prices: { input: "2", output: "10", cache_read: "0.20", cache_write_5m: "2.50", cache_write_1h: "4" },
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    // Sonnet 5.5's "default" fallback is Claude-API-only; off so the same config works on AWS.
    capabilities: {
      vision: true,
      batch: true,
      structuredOutput: true,
      thinking: "adaptive",
      effortLevels: ALL_EFFORTS,
      serverFallback: false,
    },
    teacherSelectable: true,
  },
  {
    id: "claude-haiku-5-5",
    provider: "anthropic",
    apiModel: "claude-haiku-5-5",
    displayName: "Claude Haiku 5.5",
    prices: {
      input: "0.10",
      output: "0.50",
      cache_read: "0.01", // UNVERIFIED (0.1x input)
      cache_write_5m: "0.125",
      cache_write_1h: "0.20",
      long_context_threshold: 100_000,
      long_context_input: "0.50",
      long_context_output: "2.50",
    },
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    capabilities: {
      vision: true,
      batch: true,
      structuredOutput: true,
      thinking: "adaptive",
      effortLevels: ALL_EFFORTS,
      serverFallback: false,
    },
    teacherSelectable: false,
  },
  {
    id: "gpt-6-astra",
    provider: "openai",
    apiModel: "gpt-6-astra",
    displayName: "GPT-6 Astra",
    prices: { input: "10", output: "50", cache_read: "1", cache_write_5m: "12.50", cache_write_1h: "25" }, // cache_read UNVERIFIED
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    capabilities: {
      vision: true,
      batch: true,
      structuredOutput: true,
      effortLevels: ["low", "medium", "high"],
    },
    teacherSelectable: true,
  },
  {
    id: "gpt-6.1-sol",
    provider: "openai",
    apiModel: "gpt-6.1-sol",
    displayName: "GPT-6.1 Sol",
    prices: { input: "2", output: "10", cache_read: "0.10", cache_write_5m: "2.50", cache_write_1h: "5" },
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    capabilities: {
      vision: true,
      batch: true,
      structuredOutput: true,
      effortLevels: ["low", "medium", "high"],
    },
    teacherSelectable: true,
  },
  {
    id: "gpt-6-luna",
    provider: "openai",
    apiModel: "gpt-6-luna",
    displayName: "GPT-6 Luna",
    prices: {
      input: "0.10",
      output: "0.50",
      cache_read: "0.01",
      cache_write_5m: "0.125",
      cache_write_1h: "0.25",
    }, // cache_read UNVERIFIED
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    capabilities: {
      vision: true,
      batch: true,
      structuredOutput: true,
      effortLevels: ["low", "medium", "high"],
    },
    teacherSelectable: false,
  },
];

/**
 * The top model for anything a teacher sees or that decides correctness; the cheap model for bulk chores.
 * `crossProvider` routes run on the other provider than the content's generator (blind re-solve).
 */
export const DEFAULT_ROUTES: RouteRow[] = [
  // ingestion (mostly through the Batch APIs)
  { task: "ocr_text", modelId: "claude-haiku-5-5", effort: "low", maxTokens: 16_000 },
  { task: "ocr_math", modelId: "claude-opus-5-5", effort: "low", maxTokens: 16_000 },
  { task: "segment", modelId: "claude-opus-5-5", effort: "low", maxTokens: 32_000 },
  { task: "tag", modelId: "claude-haiku-5-5", effort: "medium", maxTokens: 4_000 },
  { task: "context_header", modelId: "claude-haiku-5-5", effort: "low", maxTokens: 1_000 },
  // studio
  { task: "query_understanding", modelId: "claude-haiku-5-5", effort: "low", maxTokens: 2_000 },
  { task: "spec", modelId: "claude-haiku-5-5", effort: "medium", maxTokens: 4_000 },
  { task: "chat_title", modelId: "claude-haiku-5-5", effort: "low", maxTokens: 200 },
  { task: "generate", modelId: "claude-opus-5-5", effort: "high", maxTokens: 64_000 },
  { task: "edit_agent", modelId: "claude-opus-5-5", effort: "medium", maxTokens: 32_000 },
  { task: "notes_write", modelId: "claude-opus-5-5", effort: "high", maxTokens: 32_000 },
  { task: "chat_qa", modelId: "claude-opus-5-5", effort: "low", maxTokens: 16_000 },
  // verification
  { task: "verify_grounding", modelId: "claude-opus-5-5", effort: "medium", maxTokens: 8_000 },
  {
    task: "verify_solve",
    modelId: "gpt-6-astra",
    effort: "high",
    maxTokens: 32_000,
    options: { crossProvider: true, altModelId: "claude-opus-5-5" },
  },
  { task: "lint", modelId: "claude-sonnet-5-5", effort: "medium", maxTokens: 8_000 },
  { task: "bilingual_check", modelId: "claude-opus-5-5", effort: "low", maxTokens: 8_000 },
];

/** Inserts defaults that don't exist yet; never overwrites admin edits. Run as the schema owner. */
export async function seedLlmRegistry(db: Database): Promise<void> {
  await db
    .insert(schema.llmModels)
    .values(DEFAULT_MODELS)
    .onConflictDoNothing({ target: schema.llmModels.id });
  await db
    .insert(schema.taskRoutes)
    .values(DEFAULT_ROUTES.map((r) => ({ ...r, orgId: null })))
    .onConflictDoNothing({ target: [schema.taskRoutes.task, schema.taskRoutes.orgId] });
}
