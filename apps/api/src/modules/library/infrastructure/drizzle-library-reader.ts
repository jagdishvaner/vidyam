import { Injectable } from "@nestjs/common";
import type { LibraryQuery, LibrarySummary } from "@vidyam/contracts";
import { schema } from "@vidyam/db";
import { and, asc, count, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";

import { OrgDatabase } from "../../../shared/database/org-database.js";
import type { LibraryReader, PageRow, SectionRow, SourceRow } from "../application/browse-library.js";
import { READ_STAGES } from "../domain/source-state.js";

const { sources, pages, chunks } = schema;

// Per-source counts as correlated subqueries (chunks and pages are indexed by source). Drizzle leaves column
// names unqualified in single-table queries, so the outer `sources.id` must be spelled out: a bare "id" inside
// the subquery would mean the inner table's own id.
const sourceId = sql`${sources}.${sql.identifier("id")}`;
const sections = sql<number>`(select count(*)::int from ${chunks} where ${chunks.sourceId} = ${sourceId})`;
const ocrPages = sql<number>`(select count(*)::int from ${pages}
  where ${pages.sourceId} = ${sourceId} and ${pages.meta} ? 'awaitingOcr')`;

// The same rules as domain/source-state.ts, as SQL, so filtering and paging happen in the database.
const failed = sql`${sources.status} = 'failed'`;
const read = inArray(sources.stage, [...READ_STAGES] as (typeof sources.stage._.data)[]);
const inProgress = sql`${sources.status} <> 'failed' and (not ${read} or ${sources.status} = 'running')`;
const FILTERS: Record<LibraryQuery["show"], SQL | undefined> = {
  all: undefined,
  failed,
  in_progress: inProgress,
  ready: sql`${sources.status} not in ('failed', 'running') and ${read}
    and not (${sections} = 0 and ${ocrPages} > 0)`,
  needs_ocr: sql`${ocrPages} > 0`,
};

const ROW = {
  id: sources.id,
  filename: sources.filename,
  kind: sources.kind,
  licence: sources.licence,
  language: sources.language,
  s3Key: sources.s3Key,
  stage: sources.stage,
  status: sources.status,
  pageCount: sources.pageCount,
  meta: sources.meta,
  error: sources.error,
  createdAt: sources.createdAt,
  sections,
  ocrPages,
};

/** No explicit org filter anywhere: row-level security scopes every query to the organization. */
@Injectable()
export class DrizzleLibraryReader implements LibraryReader {
  constructor(private readonly orgDb: OrgDatabase) {}

  summary(orgId: string): Promise<LibrarySummary> {
    return this.orgDb.run(orgId, async (tx) => {
      const [files] = await tx
        .select({
          files: count(),
          failed: sql<number>`count(*) filter (where ${failed})::int`,
          inProgress: sql<number>`count(*) filter (where ${inProgress})::int`,
        })
        .from(sources);
      const [sectionCount] = await tx.select({ n: count() }).from(chunks);
      const [ocrCount] = await tx
        .select({ n: count() })
        .from(pages)
        .where(sql`${pages.meta} ? 'awaitingOcr'`);
      return {
        files: files?.files ?? 0,
        sections: sectionCount?.n ?? 0,
        ocrPages: ocrCount?.n ?? 0,
        failed: files?.failed ?? 0,
        inProgress: files?.inProgress ?? 0,
      };
    });
  }

  list(orgId: string, query: LibraryQuery, pageSize: number) {
    const search = query.search
      ? ilike(sources.filename, `%${query.search.replace(/[\\%_]/g, "\\$&")}%`)
      : undefined;
    const where = and(FILTERS[query.show], search);
    return this.orgDb.run(orgId, async (tx) => {
      const rows: SourceRow[] = await tx
        .select(ROW)
        .from(sources)
        .where(where)
        .orderBy(desc(sources.createdAt), asc(sources.filename))
        .limit(pageSize)
        .offset((query.page - 1) * pageSize);
      const [total] = await tx.select({ n: count() }).from(sources).where(where);
      return { rows, total: total?.n ?? 0 };
    });
  }

  find(orgId: string, sourceId: string): Promise<SourceRow | null> {
    return this.orgDb.run(orgId, async (tx) => {
      const [row] = await tx.select(ROW).from(sources).where(eq(sources.id, sourceId));
      return row ?? null;
    });
  }

  pages(orgId: string, sourceId: string): Promise<PageRow[]> {
    return this.orgDb.run(orgId, (tx) =>
      tx
        .select({
          pageNo: pages.pageNo,
          method: pages.method,
          confidence: pages.confidence,
          meta: pages.meta,
        })
        .from(pages)
        .where(eq(pages.sourceId, sourceId))
        .orderBy(asc(pages.pageNo)),
    );
  }

  sections(orgId: string, sourceId: string, limit: number): Promise<SectionRow[]> {
    return this.orgDb.run(orgId, (tx) =>
      tx
        .select({
          text: chunks.text,
          pageStart: chunks.pageStart,
          pageEnd: chunks.pageEnd,
          language: chunks.language,
        })
        .from(chunks)
        .where(eq(chunks.sourceId, sourceId))
        .orderBy(asc(chunks.position))
        .limit(limit),
    );
  }
}
