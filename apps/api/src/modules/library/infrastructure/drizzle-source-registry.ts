import { schema, withOrgContext, type DatabaseHandle } from "@vidyam/db";
import { eq } from "drizzle-orm";

import type { SourceRecord, SourceRegistry } from "../application/import-source.js";

/** No explicit org filter on reads: row-level security scopes them to the organization. */
export class DrizzleSourceRegistry implements SourceRegistry {
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
}
