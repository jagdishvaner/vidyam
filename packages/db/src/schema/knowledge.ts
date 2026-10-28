/** Exams, the syllabus taxonomy, glossary, and the chunks that retrieval indexes in Qdrant. */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { sources, sourceSections } from "./content.js";
import { createdAt, id, orgId, orgIsolation, timestamps } from "./_shared.js";

export const LANGUAGES = ["hi", "en"] as const;

export const exams = pgTable(
  "exams",
  {
    id: id(),
    orgId: orgId(),
    code: text().notNull(), // e.g. "rpsc_2nd_grade_paper2_science", "jee_main"
    /** The exam a paper belongs to ("rpsc_2nd_grade", "reet"); `code` names one paper of it. */
    family: text(),
    paperCode: text(),
    nameEn: text().notNull(),
    nameHi: text(),
    /** Which language wins when the Hindi and English versions of a question disagree. */
    authoritativeLanguage: text({ enum: LANGUAGES }).notNull().default("en"),
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [unique().on(t.orgId, t.code), orgIsolation("exams")],
).enableRLS();

export const CHUNK_KINDS = ["prose", "question", "solution", "definition", "table"] as const;
export const TAG_METHODS = ["manifest", "section", "llm", "human"] as const;

export const TAXONOMY_LEVELS = ["subject", "unit", "chapter", "topic", "subtopic"] as const;

/** Canonical syllabus tree shared across exams: Subject → Unit → Chapter → Topic → Subtopic. */
export const taxonomyNodes = pgTable(
  "taxonomy_nodes",
  {
    id: id(),
    orgId: orgId(),
    parentId: uuid().references((): AnyPgColumn => taxonomyNodes.id, { onDelete: "cascade" }),
    level: text({ enum: TAXONOMY_LEVELS }).notNull(),
    /**
     * Stable slug, unique among siblings ("physics", "rotational_motion"). Manifests and syllabus imports refer
     * to nodes by code path, because ids differ between local, staging and production.
     */
    code: text().notNull(),
    nameEn: text().notNull(),
    nameHi: text(),
    /** Spellings teachers actually type, incl. transliterations ("Newton ke niyam"). */
    aliases: text().array().notNull().default([]),
    sortOrder: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
    /** Learning objectives and notes; objectives double as retrieval queries for the topic. */
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    index().on(t.orgId, t.parentId),
    unique().on(t.orgId, t.parentId, t.code).nullsNotDistinct(),
    orgIsolation("taxonomy_nodes"),
  ],
).enableRLS();

export const examSyllabus = pgTable(
  "exam_syllabus",
  {
    orgId: orgId(),
    examId: uuid()
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    nodeId: uuid()
      .notNull()
      .references(() => taxonomyNodes.id, { onDelete: "cascade" }),
    weightage: real(),
  },
  (t) => [primaryKey({ columns: [t.examId, t.nodeId] }), orgIsolation("exam_syllabus")],
).enableRLS();

export const examBlueprints = pgTable(
  "exam_blueprints",
  {
    id: id(),
    orgId: orgId(),
    examId: uuid()
      .notNull()
      .references(() => exams.id, { onDelete: "cascade" }),
    name: text().notNull(),
    version: integer().notNull().default(1),
    /** Sections, question-type mix, marks, negative marking, duration, instructions. */
    spec: jsonb().$type<Record<string, unknown>>().notNull(),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [unique().on(t.examId, t.name, t.version), orgIsolation("exam_blueprints")],
).enableRLS();

export const GLOSSARY_SOURCES = ["mined", "cstt", "manual"] as const;

export const glossaryTerms = pgTable(
  "glossary_terms",
  {
    id: id(),
    orgId: orgId(),
    termEn: text().notNull(),
    termHi: text().notNull(),
    subjectNodeId: uuid().references(() => taxonomyNodes.id, { onDelete: "set null" }),
    source: text({ enum: GLOSSARY_SOURCES }).notNull(),
    approved: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [unique().on(t.orgId, t.termEn, t.termHi), orgIsolation("glossary_terms")],
).enableRLS();

/** Text is kept here as the source of truth; Qdrant holds the vectors plus a payload copy for fast search. */
export const chunks = pgTable(
  "chunks",
  {
    id: id(),
    orgId: orgId(),
    sourceId: uuid()
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    /** Reading order within the source, from 0: previews and neighbouring-passage expansion need it. */
    position: integer().notNull(),
    sectionId: uuid().references((): AnyPgColumn => sourceSections.id, { onDelete: "set null" }),
    /** Headings above the chunk ("Physics › Rotational Motion › Torque"); embedded with the text. */
    headingPath: text(),
    kind: text({ enum: CHUNK_KINDS }).notNull().default("prose"),
    contentHash: text(),
    chunkerVersion: text(),
    embeddingVersionId: text().references((): AnyPgColumn => embeddingVersions.id),
    indexedAt: timestamp({ withTimezone: true }),
    /** When a model last picked its topics (the tag backlog), even if none fitted; null means not yet. */
    topicsCheckedAt: timestamp({ withTimezone: true }),
    parentId: uuid().references((): AnyPgColumn => chunks.id, { onDelete: "cascade" }),
    pageStart: integer(),
    pageEnd: integer(),
    startMs: integer(), // video segments
    endMs: integer(),
    text: text().notNull(),
    contextHeader: text(),
    language: text({ enum: ["hi", "en", "mixed"] }).notNull(),
    tokenCount: integer().notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.sourceId, t.position), orgIsolation("chunks")],
).enableRLS();

export const chunkTags = pgTable(
  "chunk_tags",
  {
    orgId: orgId(),
    chunkId: uuid()
      .notNull()
      .references(() => chunks.id, { onDelete: "cascade" }),
    nodeId: uuid()
      .notNull()
      .references(() => taxonomyNodes.id, { onDelete: "cascade" }),
    confidence: real(),
    /** How the tag was decided: from the manifest, the source section, an LLM, or a person. */
    method: text({ enum: TAG_METHODS }).notNull(),
    taggerVersion: text(),
    isPrimary: boolean().notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.chunkId, t.nodeId] }), index().on(t.nodeId), orgIsolation("chunk_tags")],
).enableRLS();

/** One row per embedding model/config; re-embedding writes a new version and flips the Qdrant alias. Global. */
export const embeddingVersions = pgTable("embedding_versions", {
  id: text().primaryKey(), // e.g. "qwen3-embedding-4b@2560"
  provider: text().notNull(),
  model: text().notNull(),
  dims: integer().notNull(),
  isActive: boolean().notNull().default(false),
  createdAt: createdAt(),
});
