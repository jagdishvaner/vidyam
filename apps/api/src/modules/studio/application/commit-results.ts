import { Inject, Injectable } from "@nestjs/common";
import type {
  SaveDocumentVersionInput,
  SaveDocumentVersionResult,
  UpdateGenerationRunInput,
  UpdateGenerationRunResult,
} from "@vidyam/contracts";

import { DomainError } from "../../../shared/kernel/errors.js";

export type SavedVersion = SaveDocumentVersionResult | { conflict: number } | null;

/** Port: documents, their versions, and generation runs (Postgres, under the center's row-level security). */
export interface StudioStore {
  /**
   * In one transaction: version baseVersion + 1, if the document is still at baseVersion; the same version
   * again if a retry finds it already saved with this content; otherwise the document's current version.
   */
  saveVersion(input: SaveDocumentVersionInput): Promise<SavedVersion>;
  updateRun(input: UpdateGenerationRunInput): Promise<UpdateGenerationRunResult | null>;
}
export const STUDIO_STORE = Symbol("STUDIO_STORE");

/**
 * What workflows commit to documents and generation runs (ADR 0017): the API is the only writer, and each
 * commit is safe to retry.
 */
@Injectable()
export class CommitResults {
  constructor(@Inject(STUDIO_STORE) private readonly store: StudioStore) {}

  async saveVersion(input: SaveDocumentVersionInput): Promise<SaveDocumentVersionResult> {
    const saved = await this.store.saveVersion(input);
    if (saved === null) throw new DomainError("That document doesn't exist.", "not_found");
    if ("conflict" in saved) {
      throw new DomainError(
        `The document changed meanwhile: it is at version ${saved.conflict}, not ${input.baseVersion}.`,
        "conflict",
      );
    }
    return saved;
  }

  async updateRun(input: UpdateGenerationRunInput): Promise<UpdateGenerationRunResult> {
    const updated = await this.store.updateRun(input);
    if (updated === null) throw new DomainError("That generation run doesn't exist.", "not_found");
    return updated;
  }
}
