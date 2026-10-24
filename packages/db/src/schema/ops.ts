/** Operational state: ingestion pipeline progress (the record the reconciler trusts) and the audit log. */
import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth.js";
import { PIPELINE_STAGES, sources, STAGE_STATUSES } from "./content.js";
import { createdAt, id, orgId, orgIsolation } from "./_shared.js";

/**
 * One row per (source, stage). Postgres, not the queue, is the source of truth for pipeline state: a
 * reconciler re-enqueues stages that are pending/running without a live job (ADR 0005).
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
