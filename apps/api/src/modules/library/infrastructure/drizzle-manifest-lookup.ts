import { schema, withOrgContext, type DatabaseHandle } from "@vidyam/db";
import { inArray } from "drizzle-orm";

import { loadTree } from "../../syllabus/infrastructure/drizzle-syllabus-store.js";
import type { IngestBatches, ManifestLookup } from "../application/import-manifest.js";
import type { LibraryFile, ManifestCatalog } from "../domain/manifest.js";

const { exams, ingestBatches, sources } = schema;

/** No explicit org filter on reads: row-level security scopes them to the organization. */
export class DrizzleManifestLookup implements ManifestLookup, IngestBatches {
  constructor(private readonly database: DatabaseHandle) {}

  catalog(orgId: string): Promise<ManifestCatalog> {
    return withOrgContext(this.database.db, orgId, async (tx) => {
      const { rows, paths } = await loadTree(tx);
      const examRows = await tx.select({ code: exams.code }).from(exams);
      return {
        subjects: new Map(rows.filter((row) => !row.parentId).map((row) => [row.code, row.id])),
        nodes: new Map(rows.map((row) => [paths.get(row.id)!, { id: row.id, level: row.level }])),
        examCodes: new Set(examRows.map((row) => row.code)),
      };
    });
  }

  libraryFiles(orgId: string, filenames: string[]): Promise<LibraryFile[]> {
    return withOrgContext(this.database.db, orgId, (tx) =>
      tx
        .select({
          id: sources.id,
          filename: sources.filename,
          kind: sources.kind,
          setCode: sources.setCode,
          parallelGroupId: sources.parallelGroupId,
        })
        .from(sources)
        .where(inArray(sources.filename, filenames)),
    );
  }

  async setParallelGroup(orgId: string, sourceIds: string[], groupId: string): Promise<void> {
    await withOrgContext(this.database.db, orgId, (tx) =>
      tx
        .update(sources)
        .set({ parallelGroupId: groupId, updatedAt: new Date() })
        .where(inArray(sources.id, sourceIds)),
    );
  }

  async create(
    orgId: string,
    batch: { id: string; name: string; manifestS3Key: string; fileCount: number; uploadedBy: string | null },
  ): Promise<void> {
    await withOrgContext(this.database.db, orgId, (tx) =>
      tx.insert(ingestBatches).values({ orgId, ...batch }),
    );
  }
}
