/** Admin-editable LLM configuration and the usage ledger. Written and read by the Python AI engine. */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth.js";
import { appRole, createdAt, currentOrgId, id, orgId, orgIsolation, timestamps } from "./_shared.js";

/** Model registry. Model ids and prices are configuration, never code. Global (all organizations). */
export const llmModels = pgTable("llm_models", {
  id: text().primaryKey(), // registry key, e.g. "claude-opus-5-5"
  provider: text({ enum: ["anthropic", "openai"] }).notNull(),
  apiModel: text().notNull(),
  displayName: text().notNull(),
  /** USD per million tokens: input, output, cache_read, cache_write_5m, cache_write_1h, long-context tiers. */
  prices: jsonb().$type<Record<string, string | number>>().notNull(),
  contextWindow: integer().notNull(),
  maxOutputTokens: integer().notNull(),
  /** vision, batch, structured_output, server_fallback, effort_levels, thinking, ... */
  capabilities: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean().notNull().default(true),
  teacherSelectable: boolean().notNull().default(false),
  ...timestamps,
});

/** Which model runs which task. org_id NULL is the global default; an organization row overrides it. */
export const taskRoutes = pgTable(
  "task_routes",
  {
    id: id(),
    task: text().notNull(),
    orgId: uuid(),
    modelId: text()
      .notNull()
      .references(() => llmModels.id),
    effort: text({ enum: ["low", "medium", "high", "xhigh", "max"] }),
    maxTokens: integer().notNull(),
    fallbackModelId: text().references(() => llmModels.id),
    options: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    unique().on(t.task, t.orgId).nullsNotDistinct(),
    pgPolicy("task_routes_global_or_own", {
      as: "permissive",
      for: "select",
      to: appRole,
      using: sql`org_id is null or org_id = ${currentOrgId}`,
    }),
    pgPolicy("task_routes_own_writes", {
      as: "permissive",
      for: "all",
      to: appRole,
      using: sql`org_id = ${currentOrgId}`,
      withCheck: sql`org_id = ${currentOrgId}`,
    }),
  ],
).enableRLS();

/** Versioned per model family: a prompt tuned for Claude is not assumed to suit GPT. Global. */
export const promptTemplates = pgTable(
  "prompt_templates",
  {
    id: id(),
    name: text().notNull(),
    modelFamily: text({ enum: ["claude", "gpt", "any"] }).notNull(),
    version: integer().notNull(),
    body: text().notNull(),
    isActive: boolean().notNull().default(false),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.name, t.modelFamily, t.version)],
);

/** Usage ledger: one row per provider call. Feeds the cost dashboard, quotas and provider comparison. */
export const llmCalls = pgTable(
  "llm_calls",
  {
    id: id(),
    orgId: orgId(),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    task: text().notNull(),
    provider: text().notNull(),
    modelId: text().notNull(), // kept as text so history survives registry edits
    promptVersion: text(),
    inputTokens: integer().notNull(), // uncached input only
    cacheWriteTokens: integer().notNull(),
    cacheReadTokens: integer().notNull(),
    outputTokens: integer().notNull(),
    costUsd: numeric({ precision: 12, scale: 6 }).notNull(),
    latencyMs: integer().notNull(),
    isBatch: boolean().notNull().default(false),
    stopReason: text(),
    requestId: text(),
    error: text(),
    chatSessionId: uuid(),
    documentId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.orgId, t.createdAt), orgIsolation("llm_calls")],
).enableRLS();

/** Provider Batch API jobs: submitted, then polled by a scheduled job (no worker waits for up to 24 h). */
export const llmBatches = pgTable(
  "llm_batches",
  {
    id: id(),
    orgId: orgId(),
    provider: text({ enum: ["anthropic", "openai"] }).notNull(),
    providerBatchId: text().notNull(),
    task: text().notNull(),
    status: text({ enum: ["submitted", "in_progress", "ended", "collected", "failed", "expired"] }).notNull(),
    requestCount: integer().notNull(),
    submittedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp({ withTimezone: true }),
    collectedAt: timestamp({ withTimezone: true }),
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [unique().on(t.provider, t.providerBatchId), index().on(t.status), orgIsolation("llm_batches")],
).enableRLS();

/** Monthly spend limit for an organization (user_id NULL) or one user. Usage is summed from llm_calls. */
export const quotas = pgTable(
  "quotas",
  {
    id: id(),
    orgId: orgId(),
    userId: uuid().references(() => users.id, { onDelete: "cascade" }),
    monthlyLimitUsd: numeric({ precision: 10, scale: 2 }).notNull(),
    softLimitPct: integer().notNull().default(80),
    ...timestamps,
  },
  (t) => [unique().on(t.orgId, t.userId).nullsNotDistinct(), orgIsolation("quotas")],
).enableRLS();
