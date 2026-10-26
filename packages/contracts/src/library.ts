import { z } from "zod";

import { Licence, SourceKind, SourceLanguage, Uuid } from "./common.js";
import { contract } from "./registry.js";

const count = z.number().int().nonnegative();

/**
 * Where a file is, in words a center can act on (derived from the pipeline's stage and status):
 * queued → reading → ready, or waiting_for_ocr when nothing in it is readable yet, or failed.
 * A ready file can still have some pages waiting for OCR (see `ocrPages`).
 */
export const SourceState = contract(
  "SourceState",
  z.enum(["queued", "reading", "ready", "waiting_for_ocr", "failed"]),
);
export type SourceState = z.infer<typeof SourceState>;

/** List filter: everything, by state, or files with any page waiting for OCR. */
export const LibraryFilter = contract(
  "LibraryFilter",
  z.enum(["all", "ready", "in_progress", "needs_ocr", "failed"]),
);
export type LibraryFilter = z.infer<typeof LibraryFilter>;

export const LibraryQuery = contract(
  "LibraryQuery",
  z.object({
    show: LibraryFilter.default("all"),
    search: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().min(1).default(1),
  }),
);
export type LibraryQuery = z.infer<typeof LibraryQuery>;

export const LibrarySource = contract(
  "LibrarySource",
  z.object({
    id: Uuid,
    filename: z.string(),
    kind: SourceKind,
    licence: Licence,
    language: SourceLanguage.nullable(),
    state: SourceState,
    /** Null for formats without pages (Word, text). */
    pages: count.nullable(),
    /** Searchable sections cut from the readable text. */
    sections: count,
    ocrPages: count,
    meta: z.record(z.string(), z.string()),
    error: z.string().nullable(),
    addedAt: z.iso.datetime({ offset: true }),
  }),
);
export type LibrarySource = z.infer<typeof LibrarySource>;

export const LIBRARY_PAGE_SIZE = 25;

export const LibraryPage = contract(
  "LibraryPage",
  z.object({ items: z.array(LibrarySource), total: count, pageSize: count }),
);
export type LibraryPage = z.infer<typeof LibraryPage>;

export const LibrarySummary = contract(
  "LibrarySummary",
  z.object({ files: count, sections: count, ocrPages: count, failed: count, inProgress: count }),
);
export type LibrarySummary = z.infer<typeof LibrarySummary>;

/** How one page's text was obtained. */
export const PageReadingState = contract(
  "PageReadingState",
  z.enum(["text", "converted", "waiting_for_ocr", "blank"]),
);
export type PageReadingState = z.infer<typeof PageReadingState>;

export const LibrarySourceDetail = contract(
  "LibrarySourceDetail",
  z.object({
    source: LibrarySource,
    pageReadings: z.array(
      z.object({
        pageNo: z.number().int().positive().nullable(),
        state: PageReadingState,
        confidence: z.number().min(0).max(1).nullable(),
        note: z.string().nullable(),
      }),
    ),
    /** The first sections, so people can check how the text came out (Hindi conversion especially). */
    sectionPreview: z.array(
      z.object({
        text: z.string(),
        pageStart: z.number().int().nullable(),
        pageEnd: z.number().int().nullable(),
        language: SourceLanguage,
      }),
    ),
  }),
);
export type LibrarySourceDetail = z.infer<typeof LibrarySourceDetail>;
