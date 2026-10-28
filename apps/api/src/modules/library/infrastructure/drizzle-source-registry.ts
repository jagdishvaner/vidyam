import { schema, withOrgContext, type DatabaseHandle } from "@vidyam/db";
import { eq } from "drizzle-orm";

import type { SourceDescription, SourceRecord, SourceRegistry } from "../application/import-source.js";
import type { SourceRemover } from "../application/remove-source.js";

const { sources } = schema;

/** The columns a description covers, read back in the same shape to see whether anything changed. */
const DESCRIPTION = {
  kind: sources.kind,
  licence: sources.licence,
  language: sources.language,
  title: sources.title,
  subjectNodeId: sources.subjectNodeId,
  examCodes: sources.examCodes,
  classLevel: sources.classLevel,
  year: sources.year,
  setCode: sources.setCode,
  answerKeyForSourceId: sources.answerKeyForSourceId,
  parallelGroupId: sources.parallelGroupId,
  pageOffset: sources.pageOffset,
  fontHint: sources.fontHint,
  meta: sources.meta,
};

/** JSON with object keys sorted: Postgres returns jsonb keys in its own order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

/** No explicit org filter on reads: row-level security scopes them to the organization. */
export class DrizzleSourceRegistry implements SourceRegistry, SourceRemover {
  constructor(private readonly database: DatabaseHandle) {}

  findBySha256(orgId: string, sha256: string) {
    return withOrgContext(this.database.db, orgId, async (tx) => {
      const [row] = await tx
        .select({ id: schema.sources.id, stage: schema.sources.stage, status: schema.sources.status })
        .from(schema.sources)
        .where(eq(schema.sources.sha256, sha256));
      return row ?? null;
    });
  }

  async describe(orgId: string, sourceId: string, description: SourceDescription): Promise<boolean> {
    const { manifestBatchId: _batch, ...described } = description;
    return withOrgContext(this.database.db, orgId, async (tx) => {
      const [current] = await tx.select(DESCRIPTION).from(sources).where(eq(sources.id, sourceId));
      if (!current) return false;
      // The description owns only its own meta keys; what the pipeline keeps there (a key's answers) stays.
      const wanted = { ...described, meta: { ...current.meta, ...described.meta } };
      if (canonical(current) === canonical({ ...current, ...wanted })) return false;
      await tx
        .update(sources)
        .set({ ...wanted, manifestBatchId: description.manifestBatchId, updatedAt: new Date() })
        .where(eq(sources.id, sourceId));
      return true;
    });
  }

  create(orgId: string, source: SourceRecord): Promise<string> {
    return withOrgContext(this.database.db, orgId, async (tx) => {
      const [row] = await tx
        .insert(schema.sources)
        .values({ orgId, ...source })
        .returning({ id: schema.sources.id });
      return row!.id;
    });
  }

  /**
   * Pages, sections and pipeline runs go with it (foreign keys cascade). In the same transaction, the outbox
   * tells the AI engine to drop the file's vectors, so its text leaves search too (the API never calls Qdrant).
   */
  async remove(orgId: string, sourceId: string): Promise<void> {
    await withOrgContext(this.database.db, orgId, async (tx) => {
      await tx.delete(schema.sources).where(eq(schema.sources.id, sourceId));
      await tx
        .insert(schema.indexOutbox)
        .values({ orgId, entity: "source", entityId: sourceId, op: "delete" });
    });
  }
}
