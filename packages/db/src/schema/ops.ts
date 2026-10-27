/** Operational state: ingestion progress, the index outbox, and the audit log. */
import { bigint, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { organizations, users } from "./auth.js";
import { PIPELINE_STAGES, sources, STAGE_STATUSES } from "./content.js";
import { createdAt, id, orgId, orgIsolation } from "./_shared.js";

/**
 * One row per (source, stage): the progress a center sees in the Library. Temporal is the execution record
 * (ADR 0013); this is the business-facing summary, written by the ingestion activities.
 */
export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    id: id(),
    orgId: orgId(),
    sourceId: uuid()
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    stage: text({ enum: PIPELINE_STAGES }).notNull(),
    status: text({ enum: STAGE_STATUSES }).notNull().default("pending"),
    attempt: integer().notNull().default(0),
    jobId: text(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    error: text(),
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.sourceId, t.stage), index().on(t.status), orgIsolation("pipeline_runs")],
).enableRLS();

export const OUTBOX_ENTITIES = ["source", "chunk", "question"] as const;
export const OUTBOX_OPS = ["delete", "update_payload"] as const;

/**
 * Changes the vector index must follow (a removed file, retagged chunks, a retired question). Written in the
 * same transaction as the change by whichever service made it; the AI engine applies them to Qdrant in order.
 * The API never talks to Qdrant (ADR 0003), so this is how deleted text leaves search.
 * Not row-level secured: it is an internal queue drained across all organizations.
 */
export const indexOutbox = pgTable(
  "index_outbox",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    entity: text({ enum: OUTBOX_ENTITIES }).notNull(),
    entityId: uuid().notNull(),
    op: text({ enum: OUTBOX_OPS }).notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    attempts: integer().notNull().default(0),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.processedAt, t.id)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    orgId: orgId(),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text().notNull(),
    data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.orgId, t.createdAt), orgIsolation("audit_log")],
).enableRLS();
