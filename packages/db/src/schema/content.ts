/** Uploaded files and what the ingestion pipeline extracts from them. */
import { bigint, index, integer, jsonb, pgTable, real, text, unique, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth.js";
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
export const PIPELINE_STAGES = [
  "uploaded",
  "triaged",
  "parsed",
  "reviewed",
  "segmented",
  "tagged",
  "chunked",
  "embedded",
  "indexed",
] as const;
export const STAGE_STATUSES = ["pending", "running", "needs_review", "done", "failed"] as const;

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
