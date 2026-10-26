import { Inject, Injectable } from "@nestjs/common";

import { DomainError } from "../../../shared/kernel/errors.js";
import { sourceState } from "../domain/source-state.js";
import { LIBRARY_READER, type LibraryReader } from "./browse-library.js";
import { ORIGINAL_STORE, type OriginalStore } from "./import-source.js";

/** Port: deletes a source and everything read from it (pages, sections) in one go. */
export interface SourceRemover {
  remove(orgId: string, sourceId: string): Promise<void>;
}
export const SOURCE_REMOVER = Symbol("SOURCE_REMOVER");

/** Takes a file out of the library: its text leaves search and the stored original is deleted. */
@Injectable()
export class RemoveSource {
  constructor(
    @Inject(LIBRARY_READER) private readonly library: LibraryReader,
    @Inject(SOURCE_REMOVER) private readonly sources: SourceRemover,
    @Inject(ORIGINAL_STORE) private readonly originals: OriginalStore,
  ) {}

  async execute(orgId: string, sourceId: string): Promise<void> {
    const row = await this.library.find(orgId, sourceId);
    if (!row) throw new DomainError("No such file in this center's library.", "not_found");
    const state = sourceState(row);
    if (state === "queued" || state === "reading") {
      throw new DomainError("This file is still being read; remove it once it has finished.", "conflict");
    }
    await this.sources.remove(orgId, sourceId);
    await this.originals.delete(row.s3Key);
  }
}
