/** The question item bank: imported past-paper questions, generated questions, and the pre-verified pool. */
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { users } from "./auth.js";
import { LICENCES, sources } from "./content.js";
import { exams, LANGUAGES, TAG_METHODS, taxonomyNodes } from "./knowledge.js";
import { createdAt, id, orgId, orgIsolation, timestamps } from "./_shared.js";

export const QUESTION_TYPES = [
  "mcq_single",
  "mcq_multi",
  "numerical",
  "integer",
  "assertion_reason",
  "match_columns",
  "statement",
  "passage",
  "short_answer",
  "long_answer",
] as const;
export const QUESTION_ORIGINS = ["imported", "generated", "pool"] as const;
export const QUESTION_STATUSES = [
  "draft",
  "verified",
  "flagged",
  "approved",
  "published",
  "retired",
] as const;

export const questions = pgTable(
  "questions",
  {
    id: id(),
    orgId: orgId(),
    qtype: text({ enum: QUESTION_TYPES }).notNull(),
    origin: text({ enum: QUESTION_ORIGINS }).notNull(),
    status: text({ enum: QUESTION_STATUSES }).notNull().default("draft"),
    /** Shape: QuestionContent in @vidyam/contracts ({ hi, en }, each with stem/options/solution). */
    content: jsonb().$type<Record<string, unknown>>().notNull(),
    authoritativeLanguage: text({ enum: LANGUAGES }).notNull(),
    /** Shape: Answer in @vidyam/contracts. */
    answer: jsonb().$type<Record<string, unknown>>().notNull(),
    marks: numeric({ precision: 6, scale: 2 }),
    negativeMarks: numeric({ precision: 6, scale: 2 }),
    difficulty: smallint(), // 1 (easy) .. 5 (hard)
    bloomLevel: text(),
    examId: uuid().references(() => exams.id, { onDelete: "set null" }),
    year: smallint(),
    passageId: uuid().references((): AnyPgColumn => questions.id, { onDelete: "cascade" }),
    figureAssetIds: uuid().array().notNull().default([]),
    licence: text({ enum: LICENCES }).notNull(),
    /** Imported: source and page. Generated: cited chunk ids, model, prompt version, slot. */
    provenance: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** Result of every verifier (grounding, blind re-solve, lint, format, novelty), shown to reviewers. */
    verification: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    usageCount: integer().notNull().default(0),
    /** When a model last picked its topics (the tag backlog), even if none fitted; null means not yet. */
    topicsCheckedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [index().on(t.orgId, t.status, t.origin), orgIsolation("questions")],
).enableRLS();

export const questionTags = pgTable(
  "question_tags",
  {
    orgId: orgId(),
    questionId: uuid()
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    nodeId: uuid()
      .notNull()
      .references(() => taxonomyNodes.id, { onDelete: "cascade" }),
    confidence: real(),
    method: text({ enum: TAG_METHODS }).notNull(),
    taggerVersion: text(),
    isPrimary: boolean().notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.questionId, t.nodeId] }),
    index().on(t.nodeId),
    orgIsolation("question_tags"),
  ],
).enableRLS();

/**
 * Where a past-year question appeared. Booklet sets A/B/C/D order questions differently, so answer keys are
 * matched by (set code, question number); a final key overrides a provisional one.
 */
export const pyqRefs = pgTable(
  "pyq_refs",
  {
    id: id(),
    orgId: orgId(),
    questionId: uuid()
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    sourceId: uuid()
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    setCode: text().notNull().default(""),
    questionNo: integer().notNull(),
    keyAnswer: jsonb().$type<Record<string, unknown>>(),
    keyStatus: text({ enum: ["provisional", "final"] }),
    keySourceId: uuid().references(() => sources.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.sourceId, t.setCode, t.questionNo),
    index().on(t.questionId),
    orgIsolation("pyq_refs"),
  ],
).enableRLS();

export const studentBatches = pgTable(
  "student_batches",
  {
    id: id(),
    orgId: orgId(),
    name: text().notNull(),
    examId: uuid().references(() => exams.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [unique().on(t.orgId, t.name), orgIsolation("student_batches")],
).enableRLS();

/** Which student batch has already seen which question, so no item reaches the same students twice. */
export const itemExposure = pgTable(
  "item_exposure",
  {
    orgId: orgId(),
    questionId: uuid()
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    studentBatchId: uuid()
      .notNull()
      .references(() => studentBatches.id, { onDelete: "cascade" }),
    documentId: uuid(),
    exposedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.questionId, t.studentBatchId] }),
    index().on(t.studentBatchId),
    orgIsolation("item_exposure"),
  ],
).enableRLS();
