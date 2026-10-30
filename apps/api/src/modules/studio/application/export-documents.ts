import { Inject, Injectable } from "@nestjs/common";
import type {
  DocumentExport,
  ExportDocumentInput,
  ExportRequest,
  FinishExportInput,
} from "@vidyam/contracts";

import { DomainError } from "../../../shared/kernel/errors.js";

export type NewExport =
  | { kind: "created"; export: DocumentExport }
  /** The first version isn't made yet. */
  | { kind: "making" }
  /** Notes print only as themselves: no answer key or solutions. */
  | { kind: "no_variant" };

/** Port: a document's exports (Postgres, under the center's row-level security). */
export interface ExportStore {
  /** A pending export of the document's current version; null if the document isn't the teacher's. */
  create(
    orgId: string,
    userId: string,
    documentId: string,
    request: ExportRequest,
  ): Promise<NewExport | null>;
  /** Newest first; null if the document isn't the teacher's. */
  list(orgId: string, userId: string, documentId: string): Promise<DocumentExport[] | null>;
  /** A finished export's file; null unless it is the teacher's and done. */
  file(
    orgId: string,
    userId: string,
    documentId: string,
    exportId: string,
  ): Promise<{ s3Key: string; filename: string } | null>;
  /** Done with its file, or failed with why; false if there is no such export. */
  finish(input: FinishExportInput): Promise<boolean>;
}
export const EXPORT_STORE = Symbol("EXPORT_STORE");

/** Port: starts the ExportDocument workflow (Temporal; the AI engine runs it, the render worker draws). */
export interface ExportStarter {
  start(input: ExportDocumentInput): Promise<void>;
}
export const EXPORT_STARTER = Symbol("EXPORT_STARTER");

/** Port: the exports bucket. */
export interface ExportFiles {
  read(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}
export const EXPORT_FILES = Symbol("EXPORT_FILES");

const TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/**
 * Printable files of a document (plan v3 step 29): a PDF, a Word file, or a Word file in Kruti Dev, of the
 * paper, its answer key or its solutions, for one booklet set. Each is made from the version current when
 * asked, so later edits don't change a file already handed out.
 */
@Injectable()
export class ExportDocuments {
  constructor(
    @Inject(EXPORT_STORE) private readonly store: ExportStore,
    @Inject(EXPORT_STARTER) private readonly starter: ExportStarter,
    @Inject(EXPORT_FILES) private readonly files: ExportFiles,
  ) {}

  async request(
    orgId: string,
    userId: string,
    documentId: string,
    request: ExportRequest,
  ): Promise<DocumentExport> {
    const made = await this.store.create(orgId, userId, documentId, request);
    if (!made) throw new DomainError("That document doesn't exist.", "not_found");
    if (made.kind === "making")
      throw new DomainError("It is still being made; export it once it is.", "conflict");
    if (made.kind === "no_variant") {
      throw new DomainError(
        "Notes print as they are: there is no answer key or solutions to export.",
        "invalid",
      );
    }
    try {
      await this.starter.start({ v: 1, orgId, requestedBy: userId, exportId: made.export.id });
    } catch (error) {
      await this.store.finish({
        v: 1,
        orgId,
        exportId: made.export.id,
        s3Key: null,
        error: "couldn't start",
      });
      throw new DomainError(`Making the file couldn't start (${String(error)}). Try again.`, "conflict");
    }
    return made.export;
  }

  async list(orgId: string, userId: string, documentId: string): Promise<DocumentExport[]> {
    const exports = await this.store.list(orgId, userId, documentId);
    if (!exports) throw new DomainError("That document doesn't exist.", "not_found");
    return exports;
  }

  async download(
    orgId: string,
    userId: string,
    documentId: string,
    exportId: string,
  ): Promise<{ bytes: Uint8Array; filename: string; contentType: string }> {
    const file = await this.store.file(orgId, userId, documentId, exportId);
    if (!file) throw new DomainError("That file isn't ready.", "not_found");
    const contentType = file.s3Key.endsWith(".pdf") ? TYPES.pdf : TYPES.docx;
    return { bytes: await this.files.read(file.s3Key), filename: file.filename, contentType };
  }

  async finish(input: FinishExportInput): Promise<void> {
    if (!(await this.store.finish(input))) throw new DomainError("That export doesn't exist.", "not_found");
  }
}
