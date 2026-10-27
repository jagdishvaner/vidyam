/** Uploaded files and what the ingestion pipeline extracts from them. */
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { users } from "./auth.js";
import { taxonomyNodes } from "./knowledge.js";
import { createdAt, id, orgId, orgIsolation, timestamps } from "./_shared.js";

export const SOURCE_KINDS = [
  "book",
  "notes",
  "question_paper",
  "answer_key",
  "booklet",
  "video",
  "image",
  "other",
] as const;
export const LICENCES = ["own", "third_party", "pyq"] as const;
export const SOURCE_LANGUAGES = ["hi", "en", "mixed"] as const;
/** In order: tagging works on chunks, so it comes after chunking (ADR 0014, plan v3 §5). */
export const PIPELINE_STAGES = [
  "uploaded",
  "triaged",
  "parsed",
  "reviewed",
  "segmented",
  "chunked",
  "tagged",
  "embedded",
  "indexed",
] as const;
export const STAGE_STATUSES = ["pending", "running", "needs_review", "done", "failed"] as const;

/** One upload of many files with a manifest (plan v3 §5): the manifest itself is kept in S3. */
export const ingestBatches = pgTable(
  "ingest_batches",
  {
    id: id(),
    orgId: orgId(),
    name: text().notNull(),
    manifestS3Key: text(),
    fileCount: integer().notNull().default(0),
    uploadedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  () => [orgIsolation("ingest_batches")],
).enableRLS();

export const sources = pgTable(
  "sources",
  {
    id: id(),
    orgId: orgId(),
    sha256: text().notNull(),
    filename: text().notNull(),
    s3Key: text().notNull(),
    mimeType: text().notNull(),
    sizeBytes: bigint({ mode: "number" }).notNull(),
    kind: text({ enum: SOURCE_KINDS }).notNull(),
    licence: text({ enum: LICENCES }).notNull(),
    language: text({ enum: SOURCE_LANGUAGES }),
    /** Hindi and English editions of the same book share a group, so retrieval can de-duplicate them. */
    parallelGroupId: uuid(),
    // Upload metadata that search and generation filter on (SourceManifest in @vidyam/contracts). Captured
    // once at upload, so content never has to be uploaded again.
    title: text(),
    subjectNodeId: uuid().references((): AnyPgColumn => taxonomyNodes.id, { onDelete: "set null" }),
    examCodes: text().array().notNull().default([]),
    classLevel: text(),
    year: smallint(),
    /** Booklet set of a question paper or its answer key (A/B/C/D). */
    setCode: text(),
    /** For an answer key: the question paper it answers. */
    answerKeyForSourceId: uuid().references((): AnyPgColumn => sources.id, { onDelete: "set null" }),
    /** Printed page number of the PDF's first page minus one, for citations ("page 47" as printed). */
    pageOffset: integer(),
    /** Font the uploader says the file is typed in, when the PDF doesn't name it ("krutidev"). */
    fontHint: text(),
    manifestBatchId: uuid().references(() => ingestBatches.id, { onDelete: "set null" }),
    /** Manifest metadata: exam, subject, class, book, author, year, booklet set code, ... */
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    stage: text({ enum: PIPELINE_STAGES }).notNull().default("uploaded"),
    status: text({ enum: STAGE_STATUSES }).notNull().default("pending"),
    error: text(),
    pageCount: integer(),
    durationSeconds: integer(),
    uploadedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [unique().on(t.orgId, t.sha256), index().on(t.orgId, t.stage), orgIsolation("sources")],
).enableRLS();

export const PARSE_METHODS = ["text_layer", "legacy_font", "vision_ocr", "manual"] as const;
export const REVIEW_STATUSES = ["not_needed", "pending", "corrected", "approved"] as const;

export const pages = pgTable(
  "pages",
  {
    id: id(),
    orgId: orgId(),
    sourceId: uuid()
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    pageNo: integer().notNull(),
    method: text({ enum: PARSE_METHODS }).notNull(),
    /** Markdown with LaTeX math, mhchem chemistry and Markdown tables; figures referenced by asset id. */
    contentMd: text().notNull().default(""),
    confidence: real(),
    reviewStatus: text({ enum: REVIEW_STATUSES }).notNull().default("not_needed"),
    imageS3Key: text(),
    /** The page number as printed in the book (citations use it). */
    pageLabel: text(),
    /** Which extractor/converter produced the text, so a converter fix can re-extract only affected pages. */
    extractorVersion: text(),
    /** Model and prompt version that produced it, cost, quality-gate results. */
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [unique().on(t.sourceId, t.pageNo), index().on(t.orgId, t.reviewStatus), orgIsolation("pages")],
).enableRLS();

export const ASSET_KINDS = ["figure", "table_image", "chem_structure"] as const;

export const assets = pgTable(
  "assets",
  {
    id: id(),
    orgId: orgId(),
    sourceId: uuid().references(() => sources.id, { onDelete: "cascade" }),
    pageId: uuid().references(() => pages.id, { onDelete: "cascade" }),
    kind: text({ enum: ASSET_KINDS }).notNull(),
    s3Key: text().notNull(),
    bbox: jsonb().$type<{ x: number; y: number; w: number; h: number }>(),
    caption: text(),
    description: text(),
    smiles: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.sourceId), orgIsolation("assets")],
).enableRLS();

export const SECTION_ORIGINS = ["manifest", "toc", "heading", "llm", "human"] as const;

/**
 * A source's structure: page ranges and the syllabus chapter each belongs to. This is how chunks inherit
 * their chapter, and how a teacher's chapter picks reach the right pages.
 */
export const sourceSections = pgTable(
  "source_sections",
  {
    id: id(),
    orgId: orgId(),
    sourceId: uuid()
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    parentId: uuid().references((): AnyPgColumn => sourceSections.id, { onDelete: "cascade" }),
    title: text().notNull(),
    pageStart: integer(),
    pageEnd: integer(),
    nodeId: uuid().references((): AnyPgColumn => taxonomyNodes.id, { onDelete: "set null" }),
    origin: text({ enum: SECTION_ORIGINS }).notNull(),
    confidence: real(),
    position: integer().notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.sourceId, t.position), orgIsolation("source_sections")],
).enableRLS();
