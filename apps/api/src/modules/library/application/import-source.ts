import { Inject, Injectable } from "@nestjs/common";
import type { IngestSourceInput, Licence, SourceKind, SourceLanguage } from "@vidyam/contracts";

import { originalKey } from "../domain/files.js";

/**
 * Upload metadata from a manifest (plan v3 §5), resolved to ids: what search and generation filter on. Files
 * added without a manifest have none of it.
 */
export interface SourceMetadata {
  title: string | null;
  subjectNodeId: string | null;
  examCodes: string[];
  classLevel: string | null;
  year: number | null;
  setCode: string | null;
  answerKeyForSourceId: string | null;
  parallelGroupId: string | null;
  pageOffset: number | null;
  fontHint: string | null;
  manifestBatchId: string | null;
}

export const NO_METADATA: SourceMetadata = {
  title: null,
  subjectNodeId: null,
  examCodes: [],
  classLevel: null,
  year: null,
  setCode: null,
  answerKeyForSourceId: null,
  parallelGroupId: null,
  pageOffset: null,
  fontHint: null,
  manifestBatchId: null,
};

/** What describes a file apart from its bytes; a manifest can change it later without uploading again. */
export interface SourceDescription extends SourceMetadata {
  kind: SourceKind;
  licence: Licence;
  language: SourceLanguage | null;
  meta: Record<string, unknown>;
}

export interface SourceRecord extends SourceDescription {
  filename: string;
  sha256: string;
  s3Key: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string | null;
}

/** Port: the organization's `sources` rows. */
export interface SourceRegistry {
  findBySha256(orgId: string, sha256: string): Promise<{ id: string; stage: string; status: string } | null>;
  create(orgId: string, source: SourceRecord): Promise<string>;
  /**
   * Replaces a file's description; true when anything changed. The batch it came with is kept, since it says
   * which upload brought the file.
   */
  describe(orgId: string, sourceId: string, description: SourceDescription): Promise<boolean>;
}
export const SOURCE_REGISTRY = Symbol("SOURCE_REGISTRY");

/** Port: where uploaded originals are kept (S3). */
export interface OriginalStore {
  /** From a file on disk, or bytes already in memory (a manifest). */
  put(
    key: string,
    file: ({ path: string } | { body: Buffer }) & { mimeType: string; sizeBytes: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
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
  description: SourceDescription;
  /**
   * From a manifest: the description is authoritative, and replaces that of a file already imported. Without
   * one (`pnpm ingest <folder> --kind …`), a file already imported is left as it is.
   */
  fromManifest: boolean;
}

export type ImportOutcome =
  | { status: "started"; sourceId: string }
  | { status: "retrying"; sourceId: string } // a previous ingestion of the same file failed
  | { status: "updated"; sourceId: string } // already imported; its description changed, so it is re-tagged
  | { status: "already_imported" | "in_progress"; sourceId: string };

/** Adds one file to an organization's library and starts reading it (ADR 0014, plan v3 §5). */
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
    const changed =
      existing && request.fromManifest
        ? await this.sources.describe(orgId, existing.id, request.description)
        : false;
    if (existing && existing.status !== "failed") {
      if (existing.stage === "uploaded") {
        // Registered but never picked up (Temporal was down when it was imported): start it now.
        const started = await this.ingestion.start(this.input(request, existing.id, "all"));
        return { status: started ? "started" : "in_progress", sourceId: existing.id };
      }
      if (!changed) return { status: "already_imported", sourceId: existing.id };
      // The pages stay; sections, chunks and tags are worked out again from the new description.
      const started = await this.ingestion.start(this.input(request, existing.id, "structure"));
      return { status: started ? "updated" : "in_progress", sourceId: existing.id };
    }

    let sourceId = existing?.id;
    if (!sourceId) {
      const s3Key = originalKey(orgId, file.sha256, file.filename);
      await this.originals.put(s3Key, file);
      sourceId = await this.sources.create(orgId, {
        ...request.description,
        filename: file.filename,
        sha256: file.sha256,
        s3Key,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        uploadedBy: request.requestedBy,
      });
    }
    await this.ingestion.start(this.input(request, sourceId, "all"));
    return { status: existing ? "retrying" : "started", sourceId };
  }

  private input(
    request: ImportRequest,
    sourceId: string,
    stages: IngestSourceInput["stages"],
  ): IngestSourceInput {
    return { v: 1, orgId: request.orgId, requestedBy: request.requestedBy, sourceId, stages };
  }
}
