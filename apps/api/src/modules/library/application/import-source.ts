import { Inject, Injectable } from "@nestjs/common";
import type { IngestSourceInput, Licence, SourceKind, SourceLanguage } from "@vidyam/contracts";

import { originalKey } from "../domain/files.js";

export interface SourceRecord {
  filename: string;
  sha256: string;
  s3Key: string;
  mimeType: string;
  sizeBytes: number;
  kind: SourceKind;
  licence: Licence;
  language: SourceLanguage | null;
  meta: Record<string, string>;
  uploadedBy: string | null;
}

/** Port: the organization's `sources` rows. */
export interface SourceRegistry {
  findBySha256(orgId: string, sha256: string): Promise<{ id: string; stage: string; status: string } | null>;
  create(orgId: string, source: SourceRecord): Promise<string>;
}
export const SOURCE_REGISTRY = Symbol("SOURCE_REGISTRY");

/** Port: where uploaded originals are kept (S3). */
export interface OriginalStore {
  put(key: string, file: { path: string; mimeType: string; sizeBytes: number }): Promise<void>;
}
export const ORIGINAL_STORE = Symbol("ORIGINAL_STORE");

/** Port: starts the ingestion workflow (Temporal; the AI engine runs it). */
export interface IngestionStarter {
  /** Returns false when ingestion of this source is already running. */
  start(input: IngestSourceInput): Promise<boolean>;
}
export const INGESTION_STARTER = Symbol("INGESTION_STARTER");

export interface ImportRequest {
  orgId: string;
  requestedBy: string | null;
  file: { path: string; filename: string; sha256: string; mimeType: string; sizeBytes: number };
  kind: SourceKind;
  licence: Licence;
  language: SourceLanguage | null;
  meta: Record<string, string>;
}

export type ImportOutcome =
  | { status: "started"; sourceId: string }
  | { status: "retrying"; sourceId: string } // a previous ingestion of the same file failed
  | { status: "already_imported" | "in_progress"; sourceId: string };

/** Adds one file to an organization's library and starts reading it (ADR 0014). */
@Injectable()
export class ImportSource {
  constructor(
    @Inject(SOURCE_REGISTRY) private readonly sources: SourceRegistry,
    @Inject(ORIGINAL_STORE) private readonly originals: OriginalStore,
    @Inject(INGESTION_STARTER) private readonly ingestion: IngestionStarter,
  ) {}

  async execute(request: ImportRequest): Promise<ImportOutcome> {
    const { orgId, file } = request;
    const existing = await this.sources.findBySha256(orgId, file.sha256);
    if (existing && existing.status !== "failed") {
      if (existing.stage !== "uploaded") return { status: "already_imported", sourceId: existing.id };
      // Registered but never picked up (Temporal was down when it was imported): start it now.
      const started = await this.ingestion.start(this.input(request, existing.id));
      return { status: started ? "started" : "in_progress", sourceId: existing.id };
    }

    let sourceId = existing?.id;
    if (!sourceId) {
      const s3Key = originalKey(orgId, file.sha256, file.filename);
      await this.originals.put(s3Key, file);
      sourceId = await this.sources.create(orgId, {
        filename: file.filename,
        sha256: file.sha256,
        s3Key,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        kind: request.kind,
        licence: request.licence,
        language: request.language,
        meta: request.meta,
        uploadedBy: request.requestedBy,
      });
    }
    await this.ingestion.start(this.input(request, sourceId));
    return { status: existing ? "retrying" : "started", sourceId };
  }

  private input(request: ImportRequest, sourceId: string): IngestSourceInput {
    return { v: 1, orgId: request.orgId, requestedBy: request.requestedBy, sourceId };
  }
}
