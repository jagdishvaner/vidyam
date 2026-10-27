import { schema, withOrgContext, type DatabaseHandle } from "@vidyam/db";
import { eq } from "drizzle-orm";

import type { SourceRecord, SourceRegistry } from "../application/import-source.js";
import type { SourceRemover } from "../application/remove-source.js";

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
