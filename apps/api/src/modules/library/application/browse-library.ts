import { Inject, Injectable } from "@nestjs/common";
import type {
  LibraryPage,
  LibraryQuery,
  LibrarySource,
  LibrarySourceDetail,
  LibrarySummary,
  Licence,
  SourceKind,
  SourceLanguage,
} from "@vidyam/contracts";

import { DomainError } from "../../../shared/kernel/errors.js";
import { pageReadingState, sourceState, type SourceProgress } from "../domain/source-state.js";

export interface SourceRow extends SourceProgress {
  id: string;
  filename: string;
  kind: SourceKind;
  licence: Licence;
  language: SourceLanguage | null;
  s3Key: string;
  pageCount: number | null;
  meta: Record<string, unknown>;
  error: string | null;
  createdAt: Date;
}

export interface PageRow {
  pageNo: number;
  method: string;
  confidence: number | null;
  meta: Record<string, unknown>;
}

export interface SectionRow {
  text: string;
  pageStart: number | null;
  pageEnd: number | null;
  language: SourceLanguage;
}

/** Port: read access to one organization's library (row-level security applies). */
export interface LibraryReader {
  summary(orgId: string): Promise<LibrarySummary>;
  list(orgId: string, query: LibraryQuery, pageSize: number): Promise<{ rows: SourceRow[]; total: number }>;
  find(orgId: string, sourceId: string): Promise<SourceRow | null>;
  pages(orgId: string, sourceId: string): Promise<PageRow[]>;
  /** The first `limit` sections in reading order. */
  sections(orgId: string, sourceId: string, limit: number): Promise<SectionRow[]>;
}
export const LIBRARY_READER = Symbol("LIBRARY_READER");

export const SECTION_PREVIEW = 10;

export function toLibrarySource(row: SourceRow): LibrarySource {
  return {
    id: row.id,
    filename: row.filename,
    kind: row.kind,
    licence: row.licence,
    language: row.language,
    state: sourceState(row),
    pages: row.pageCount,
    sections: row.sections,
    ocrPages: row.ocrPages,
    meta: Object.fromEntries(Object.entries(row.meta).map(([key, value]) => [key, String(value)])),
    error: row.error,
    addedAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class BrowseLibrary {
  constructor(@Inject(LIBRARY_READER) private readonly library: LibraryReader) {}

  summary(orgId: string): Promise<LibrarySummary> {
    return this.library.summary(orgId);
  }

  async list(orgId: string, query: LibraryQuery, pageSize: number): Promise<LibraryPage> {
    const { rows, total } = await this.library.list(orgId, query, pageSize);
    return { items: rows.map(toLibrarySource), total, pageSize };
  }

  async detail(orgId: string, sourceId: string): Promise<LibrarySourceDetail> {
    const row = await this.library.find(orgId, sourceId);
    if (!row) throw new DomainError("No such file in this center's library.", "not_found");
    const [pages, sections] = [
      await this.library.pages(orgId, sourceId),
      await this.library.sections(orgId, sourceId, SECTION_PREVIEW),
    ];
    return {
      source: toLibrarySource(row),
      pageReadings: pages.map((page) => ({
        pageNo: page.meta.virtual ? null : page.pageNo,
        state: pageReadingState(page.method, page.meta),
        confidence: page.confidence,
        note: typeof page.meta.note === "string" ? page.meta.note : null,
      })),
      sectionPreview: sections,
    };
  }
}
