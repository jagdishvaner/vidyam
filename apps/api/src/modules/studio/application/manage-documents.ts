import { Inject, Injectable } from "@nestjs/common";
import type {
  ApplyDocumentEditsInput,
  ApplyDocumentEditsResult,
  DocumentContent,
  DocumentDetail,
  DocumentEditRequest,
  DocumentListItem,
  DocumentRestoreRequest,
  DocumentVersion,
  DocumentVersionSummary,
  EditOp,
} from "@vidyam/contracts";

import { DomainError } from "../../../shared/kernel/errors.js";
import { applyEdits, type ResolvedOp } from "../domain/edits.js";
import { EXPORT_FILES, type ExportFiles } from "./export-documents.js";

/** How saving a new version went: saved, the document moved on meanwhile, or it isn't made yet. */
export type SaveOutcome =
  | { kind: "saved"; version: number }
  | { kind: "conflict"; current: number }
  | { kind: "making" }
  /** The changes don't fit the document (an item that isn't there): only the agent's edits say so. */
  | { kind: "invalid"; reason: string };

/** Port: a teacher's documents and their versions (Postgres, under the center's row-level security). */
export interface DocumentStore {
  /** A teacher's documents, most recently changed first. */
  list(orgId: string, userId: string, limit: number): Promise<DocumentListItem[]>;
  /** The current version (or the live slots while the first is made), with its questions; null if not theirs. */
  detail(orgId: string, userId: string, documentId: string): Promise<DocumentDetail | null>;
  versions(orgId: string, userId: string, documentId: string): Promise<DocumentVersionSummary[] | null>;
  version(
    orgId: string,
    userId: string,
    documentId: string,
    version: number,
  ): Promise<DocumentVersion | null>;
  /**
   * In one transaction, on the locked document: checks it is still at `baseVersion`, saves each edited question
   * as a new one in the bank, works out what replacing questions are, then saves `apply`'s result as the next
   * version. Null if the document isn't theirs.
   */
  edit(
    orgId: string,
    userId: string,
    documentId: string,
    baseVersion: number,
    ops: readonly EditOp[],
    apply: (content: DocumentContent, ops: readonly ResolvedOp[]) => DocumentContent,
    author?: "user" | "agent",
  ): Promise<SaveOutcome | null>;
  /**
   * A workflow's edit (ADR 0017) and the chat's message about it, in one transaction: saved only if the document
   * is still at the base version. A retry finds it done by its message id and answers the same.
   */
  applyFromWorkflow(
    input: ApplyDocumentEditsInput,
    apply: (content: DocumentContent, ops: readonly ResolvedOp[]) => DocumentContent,
  ): Promise<ApplyDocumentEditsResult | null>;
  /** In one transaction: an earlier version's content saved as the next version. */
  restore(
    orgId: string,
    userId: string,
    documentId: string,
    baseVersion: number,
    version: number,
  ): Promise<SaveOutcome | "no_version" | null>;
  /**
   * False while it is still being made; null if it isn't theirs. Otherwise the keys of its export files,
   * which go with it.
   */
  remove(orgId: string, userId: string, documentId: string): Promise<string[] | false | null>;
}
export const DOCUMENT_STORE = Symbol("DOCUMENT_STORE");

/**
 * The canvas (plan v3 §2, step 27): a teacher's document, edited by hand. Every change is a new version made
 * against the version it was made on, so an edit never overwrites another (from the chat's agent, say);
 * undo restores an earlier version as a new one, so history is never lost.
 */
@Injectable()
export class ManageDocuments {
  constructor(
    @Inject(DOCUMENT_STORE) private readonly store: DocumentStore,
    @Inject(EXPORT_FILES) private readonly files: ExportFiles,
  ) {}

  list(orgId: string, userId: string, limit: number): Promise<DocumentListItem[]> {
    return this.store.list(orgId, userId, limit);
  }

  async detail(orgId: string, userId: string, documentId: string): Promise<DocumentDetail> {
    return found(await this.store.detail(orgId, userId, documentId));
  }

  async versions(orgId: string, userId: string, documentId: string): Promise<DocumentVersionSummary[]> {
    return found(await this.store.versions(orgId, userId, documentId));
  }

  async version(
    orgId: string,
    userId: string,
    documentId: string,
    version: number,
  ): Promise<DocumentVersion> {
    return found(await this.store.version(orgId, userId, documentId, version));
  }

  async edit(
    orgId: string,
    userId: string,
    documentId: string,
    request: DocumentEditRequest,
    apply: (content: DocumentContent, ops: readonly ResolvedOp[]) => DocumentContent,
  ): Promise<DocumentDetail> {
    const outcome = await this.store.edit(orgId, userId, documentId, request.baseVersion, request.ops, apply);
    saved(found(outcome));
    return this.detail(orgId, userId, documentId);
  }

  async restore(
    orgId: string,
    userId: string,
    documentId: string,
    request: DocumentRestoreRequest,
  ): Promise<DocumentDetail> {
    const outcome = found(
      await this.store.restore(orgId, userId, documentId, request.baseVersion, request.version),
    );
    if (outcome === "no_version") throw new DomainError(`There is no version ${request.version}.`, "invalid");
    saved(outcome);
    return this.detail(orgId, userId, documentId);
  }

  /**
   * The chat's edit agent, for the teacher whose chat it is (plan v3 §6.9): its changes, made on the version
   * it read. The outcome is told in the chat, not thrown.
   */
  async editByAgent(
    orgId: string,
    userId: string,
    documentId: string,
    baseVersion: number,
    ops: readonly EditOp[],
  ): Promise<SaveOutcome | null> {
    try {
      return await this.store.edit(orgId, userId, documentId, baseVersion, ops, applyEdits, "agent");
    } catch (error) {
      if (error instanceof DomainError && error.kind === "invalid")
        return { kind: "invalid", reason: error.message };
      throw error;
    }
  }

  async applyFromWorkflow(input: ApplyDocumentEditsInput): Promise<ApplyDocumentEditsResult> {
    return found(await this.store.applyFromWorkflow(input, applyEdits));
  }

  async remove(orgId: string, userId: string, documentId: string): Promise<void> {
    const files = found(await this.store.remove(orgId, userId, documentId));
    if (files === false) throw new DomainError("Wait until it is made before deleting it.", "conflict");
    for (const key of files) await this.files.delete(key);
  }
}

function found<T>(value: T | null): T {
  if (value === null) throw new DomainError("That document doesn't exist.", "not_found");
  return value;
}

function saved(outcome: SaveOutcome): void {
  if (outcome.kind === "invalid") throw new DomainError(outcome.reason, "invalid");
  if (outcome.kind === "making")
    throw new DomainError("It is still being made; edit it once it is.", "conflict");
  if (outcome.kind === "conflict") {
    throw new DomainError(
      `It changed meanwhile (it is at version ${outcome.current}): your edit was made on an older one.`,
      "conflict",
    );
  }
}
