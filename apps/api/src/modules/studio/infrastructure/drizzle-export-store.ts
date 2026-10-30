import { Injectable } from "@nestjs/common";
import {
  exportFileName,
  type DocumentExport,
  type ExportFormat,
  type ExportRequest,
  type ExportVariant,
  type FinishExportInput,
} from "@vidyam/contracts";
import { schema } from "@vidyam/db";
import { and, desc, eq } from "drizzle-orm";

import { OrgDatabase } from "../../../shared/database/org-database.js";
import type { ExportStore, NewExport } from "../application/export-documents.js";

const { documents: d, documentExports: x } = schema;
const NOTES = new Set(["notes", "revision_sheet"]);

type Row = typeof x.$inferSelect;

function view(row: Row, title: string): DocumentExport {
  const variant = row.variant as ExportVariant;
  const format = row.format as ExportFormat;
  return {
    id: row.id,
    version: row.version,
    format,
    variant,
    setCode: row.setCode,
    status: row.status,
    error: row.error,
    filename: exportFileName(title, variant, row.setCode, format),
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class DrizzleExportStore implements ExportStore {
  constructor(private readonly orgDb: OrgDatabase) {}

  create(
    orgId: string,
    userId: string,
    documentId: string,
    request: ExportRequest,
  ): Promise<NewExport | null> {
    return this.orgDb.run(orgId, async (tx) => {
      const [doc] = await tx
        .select({ version: d.currentVersion, kind: d.kind, title: d.title })
        .from(d)
        .where(and(eq(d.id, documentId), eq(d.ownerId, userId)));
      if (!doc) return null;
      if (doc.version === 0) return { kind: "making" };
      if (NOTES.has(doc.kind) && request.variant !== "paper") return { kind: "no_variant" };
      const [row] = await tx
        .insert(x)
        .values({
          orgId,
          documentId,
          version: doc.version,
          format: request.format,
          variant: request.variant,
          setCode: NOTES.has(doc.kind) ? null : request.setCode,
          createdBy: userId,
        })
        .returning();
      return { kind: "created", export: view(row!, doc.title) };
    });
  }

  list(orgId: string, userId: string, documentId: string): Promise<DocumentExport[] | null> {
    return this.orgDb.run(orgId, async (tx) => {
      const [doc] = await tx
        .select({ title: d.title })
        .from(d)
        .where(and(eq(d.id, documentId), eq(d.ownerId, userId)));
      if (!doc) return null;
      const rows = await tx.select().from(x).where(eq(x.documentId, documentId)).orderBy(desc(x.createdAt));
      return rows.map((row) => view(row, doc.title));
    });
  }

  file(
    orgId: string,
    userId: string,
    documentId: string,
    exportId: string,
  ): Promise<{ s3Key: string; filename: string } | null> {
    return this.orgDb.run(orgId, async (tx) => {
      const [row] = await tx
        .select({ export: x, title: d.title })
        .from(x)
        .innerJoin(d, eq(d.id, x.documentId))
        .where(and(eq(x.id, exportId), eq(x.documentId, documentId), eq(d.ownerId, userId)));
      if (!row || row.export.status !== "done" || !row.export.s3Key) return null;
      return { s3Key: row.export.s3Key, filename: view(row.export, row.title).filename };
    });
  }

  finish(input: FinishExportInput): Promise<boolean> {
    return this.orgDb.run(input.orgId, async (tx) => {
      const updated = await tx
        .update(x)
        .set({
          status: input.s3Key ? "done" : "failed",
          s3Key: input.s3Key,
          error: input.error,
          finishedAt: new Date(),
        })
        .where(eq(x.id, input.exportId))
        .returning({ id: x.id });
      return updated.length > 0;
    });
  }
}
