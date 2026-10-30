import type { ExportFormat } from "@vidyam/contracts";

import { printDocument, type PrintDocument, type PrintRequest } from "../domain/print.js";

/** An export as asked for (document_exports), and what it prints. */
export interface ExportJob {
  exportId: string;
  documentId: string;
  format: ExportFormat;
  request: PrintRequest;
}

/** Port: the export, its document version, its questions and the center's branding (read-only). */
export interface ExportSource {
  load(orgId: string, exportId: string): Promise<ExportJob | null>;
}

/** Port: draws a printed document as a file. */
export interface FileRenderer {
  render(document: PrintDocument, options: { krutiDev: boolean }): Promise<Uint8Array>;
}

/** Port: the exports bucket. */
export interface FileStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

export class ExportNotFound extends Error {}

const TYPES: Record<"pdf" | "docx", string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/**
 * One export of a document (plan v3 step 29): the version it names, printed for its variant and booklet set,
 * drawn as a PDF or Word file (Unicode, or Kruti Dev for teachers who print in that font), and stored. The
 * API records the file once this returns (ADR 0017).
 */
export class RenderExport {
  constructor(
    private readonly source: ExportSource,
    private readonly renderers: { pdf: FileRenderer; docx: FileRenderer },
    private readonly files: FileStore,
  ) {}

  async execute(orgId: string, exportId: string): Promise<{ s3Key: string; bytes: number }> {
    const job = await this.source.load(orgId, exportId);
    if (!job) throw new ExportNotFound(`no export ${exportId}`);
    const printed = printDocument(job.request);
    const kind = job.format === "pdf" ? "pdf" : "docx";
    const body = await this.renderers[kind].render(printed, { krutiDev: job.format === "krutidev_docx" });
    const s3Key = `${orgId}/${job.documentId}/${exportId}.${kind}`;
    await this.files.put(s3Key, body, TYPES[kind]);
    return { s3Key, bytes: body.byteLength };
  }
}
