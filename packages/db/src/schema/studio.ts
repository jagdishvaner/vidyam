/** Generated documents (papers, worksheets, notes), their versions, and the chats that edit them. */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { users } from "./auth.js";
import { studentBatches } from "./items.js";
import { llmCalls, llmModels } from "./llm.js";
import { createdAt, id, orgId, orgIsolation, timestamps } from "./_shared.js";

export const DOCUMENT_KINDS = [
  "question_paper",
  "worksheet",
  "notes",
  "revision_sheet",
  "solutions",
  "flashcards",
  "lesson_plan",
] as const;
export const DOCUMENT_STATUSES = ["draft", "in_review", "approved", "published"] as const;

/** A content type: output JSON schema + prompt + HTML render template + verifier set. */
export const contentTemplates = pgTable(
  "content_templates",
  {
    id: id(),
    orgId: orgId(),
    kind: text({ enum: DOCUMENT_KINDS }).notNull(),
    name: text().notNull(),
    outputSchema: jsonb().$type<Record<string, unknown>>().notNull(),
    promptTemplate: text().notNull(),
    renderTemplate: text().notNull(),
    verifiers: text().array().notNull().default([]),
    enabled: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [unique().on(t.orgId, t.kind, t.name), orgIsolation("content_templates")],
).enableRLS();

export const documents = pgTable(
  "documents",
  {
    id: id(),
    orgId: orgId(),
    kind: text({ enum: DOCUMENT_KINDS }).notNull(),
    title: text().notNull(),
    templateId: uuid().references(() => contentTemplates.id),
    /** The confirmed PaperSpec (see @vidyam/contracts). */
    spec: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** Current state (PaperDocument for papers). document_versions holds the history. */
    content: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    currentVersion: integer().notNull().default(0),
    status: text({ enum: DOCUMENT_STATUSES }).notNull().default("draft"),
    ownerId: uuid()
      .notNull()
      .references(() => users.id),
    studentBatchId: uuid().references(() => studentBatches.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index().on(t.orgId, t.ownerId), orgIsolation("documents")],
).enableRLS();

export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: id(),
    orgId: orgId(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    documentId: uuid().references(() => documents.id, { onDelete: "set null" }),
    title: text().notNull().default(""),
    /** Teacher's per-chat model choice for generate/edit tasks (from the admin-allowed list). */
    modelOverride: text().references(() => llmModels.id),
    ...timestamps,
  },
  (t) => [index().on(t.orgId, t.userId), orgIsolation("chat_sessions")],
).enableRLS();

/**
 * Append-only: earlier rows are never edited. That keeps provider prompt caches warm and, on Claude 5.5
 * models, keeps earlier thinking blocks valid.
 */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: id(),
    orgId: orgId(),
    sessionId: uuid()
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    role: text({ enum: ["user", "assistant", "system", "tool"] }).notNull(),
    /** Provider-neutral blocks, used to rebuild context when the teacher switches model. */
    content: jsonb().$type<unknown[]>().notNull(),
    /** Exact provider-native content (incl. thinking blocks), replayed unchanged to the same model. */
    providerPayload: jsonb().$type<Record<string, unknown>>(),
    modelId: text().references(() => llmModels.id),
    llmCallId: uuid().references(() => llmCalls.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.sessionId, t.seq), orgIsolation("chat_messages")],
).enableRLS();

export const documentVersions = pgTable(
  "document_versions",
  {
    id: id(),
    orgId: orgId(),
    documentId: uuid()
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    content: jsonb().$type<Record<string, unknown>>().notNull(),
    /** Operations that produced this version from the previous one (replace_item, patch_item, ...). */
    ops: jsonb().$type<unknown[]>().notNull().default([]),
    authorKind: text({ enum: ["user", "agent", "system"] }).notNull(),
    authorId: uuid().references(() => users.id, { onDelete: "set null" }),
    chatMessageId: uuid().references((): AnyPgColumn => chatMessages.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.documentId, t.version), orgIsolation("document_versions")],
).enableRLS();

export const comments = pgTable(
  "comments",
  {
    id: id(),
    orgId: orgId(),
    documentId: uuid()
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    itemId: text(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    body: text().notNull(),
    resolved: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [index().on(t.documentId), orgIsolation("comments")],
).enableRLS();

export const feedback = pgTable(
  "feedback",
  {
    id: id(),
    orgId: orgId(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    targetType: text({ enum: ["question", "document", "chat_message"] }).notNull(),
    targetId: uuid().notNull(),
    rating: smallint(),
    reason: text(),
    /** For edits: what the teacher changed, so it can become an exemplar or an eval case. */
    diff: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.orgId, t.targetType), orgIsolation("feedback")],
).enableRLS();
