import { createHash, randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { parseManifestCsv, type ManifestProblem } from "@vidyam/contracts";

import {
  importOrder,
  planManifest,
  type LibraryFile,
  type ManifestCatalog,
  type PlannedSource,
} from "../domain/manifest.js";
import {
  ImportSource,
  ORIGINAL_STORE,
  type ImportOutcome,
  type OriginalStore,
  type SourceDescription,
} from "./import-source.js";

/** A file listed in a manifest, as found next to it. */
export interface ManifestFile {
  path: string;
  filename: string;
  /** null when the pipeline can't read this type of file. */
  mimeType: string | null;
  sha256: string;
  sizeBytes: number;
}

/** Port: the files a manifest lists, by their path relative to it (local disk for `pnpm ingest`). */
export interface ManifestFiles {
  /** null when there is no such file. */
  find(file: string): Promise<ManifestFile | null>;
}

/** Port: what a manifest is checked against. */
export interface ManifestLookup {
  catalog(orgId: string): Promise<ManifestCatalog>;
  /** Files already in the library with one of these names. */
  libraryFiles(orgId: string, filenames: string[]): Promise<LibraryFile[]>;
  /** Puts files already in the library into a group of editions (Hindi ↔ English). */
  setParallelGroup(orgId: string, sourceIds: string[], groupId: string): Promise<void>;
}
export const MANIFEST_LOOKUP = Symbol("MANIFEST_LOOKUP");

/** Port: `ingest_batches`, one row per manifest imported. */
export interface IngestBatches {
  create(
    orgId: string,
    batch: { id: string; name: string; manifestS3Key: string; fileCount: number; uploadedBy: string | null },
  ): Promise<void>;
}
export const INGEST_BATCHES = Symbol("INGEST_BATCHES");

export interface ManifestRequest {
  orgId: string;
  requestedBy: string | null;
  /** Shown in the library as where the files came from ("demo-pack/manifest.csv"). */
  name: string;
  csv: string;
  files: ManifestFiles;
}

export type ManifestResult =
  | { status: "rejected"; problems: ManifestProblem[] }
  | { status: "imported"; batchId: string; files: { file: string; outcome: ImportOutcome }[] };

/**
 * Imports the files of an upload manifest with everything search filters on (plan v3 §5). The whole manifest
 * is checked first, against the syllabus, the exam papers and the files themselves; if anything is wrong,
 * nothing is imported. Running it again updates descriptions in place: files are never uploaded twice.
 */
@Injectable()
export class ImportManifest {
  constructor(
    private readonly importSource: ImportSource,
    @Inject(MANIFEST_LOOKUP) private readonly lookup: ManifestLookup,
    @Inject(INGEST_BATCHES) private readonly batches: IngestBatches,
    @Inject(ORIGINAL_STORE) private readonly originals: OriginalStore,
  ) {}

  async execute(request: ManifestRequest): Promise<ManifestResult> {
    const { orgId } = request;
    const parsed = parseManifestCsv(request.csv);
    const found = new Map<string, ManifestFile>();
    for (const row of parsed.rows) {
      const file = await request.files.find(row.file);
      if (file) found.set(row.file, file);
    }
    const outside = parsed.rows
      .flatMap((row) => [row.answerKeyFor, row.parallelOf])
      .filter((ref): ref is string => !!ref && !parsed.rows.some((row) => row.file === ref))
      .map((ref) => ref.split("/").pop()!);
    const [catalog, library] = await Promise.all([
      this.lookup.catalog(orgId),
      outside.length ? this.lookup.libraryFiles(orgId, outside) : Promise.resolve([]),
    ]);
    const plan = planManifest(
      parsed.rows,
      parsed.lines,
      catalog,
      new Map([...found].map(([path, file]) => [path, file.mimeType])),
      (filename) => library.filter((file) => file.filename === filename),
    );
    const problems = [...parsed.problems, ...plan.problems];
    if (problems.length || parsed.rows.length === 0) {
      if (!problems.length) problems.push({ line: 1, message: "the manifest lists no files" });
      return { status: "rejected", problems: problems.sort((a, b) => a.line - b.line) };
    }

    const batchId = randomUUID();
    const manifestS3Key = `org/${orgId}/manifests/${batchId}.csv`;
    const bytes = Buffer.from(request.csv, "utf8");
    await this.originals.put(manifestS3Key, { body: bytes, mimeType: "text/csv", sizeBytes: bytes.length });
    await this.batches.create(orgId, {
      id: batchId,
      name: request.name,
      manifestS3Key,
      fileCount: plan.sources.length,
      uploadedBy: request.requestedBy,
    });

    const groups = parallelGroups(plan.sources, found, library);
    for (const [groupId, sourceIds] of groups.library) {
      await this.lookup.setParallelGroup(orgId, sourceIds, groupId);
    }
    const ids: string[] = [];
    const files: { file: string; outcome: ImportOutcome }[] = [];
    for (const i of importOrder(plan.sources)) {
      const source = plan.sources[i]!;
      const file = found.get(source.row.file)!;
      const key = source.answerKeyFor;
      const outcome = await this.importSource.execute({
        orgId,
        requestedBy: request.requestedBy,
        file: { ...file, mimeType: file.mimeType! },
        description: describe(source, {
          batchId,
          parallelGroupId: groups.rows.get(i) ?? null,
          answerKeyForSourceId: key ? ("row" in key ? ids[key.row]! : key.sourceId) : null,
        }),
        fromManifest: true,
      });
      ids[i] = outcome.sourceId;
      files.push({ file: source.row.file, outcome });
    }
    files.sort((a, b) => a.file.localeCompare(b.file));
    return { status: "imported", batchId, files };
  }
}

function describe(
  source: PlannedSource,
  links: { batchId: string; parallelGroupId: string | null; answerKeyForSourceId: string | null },
): SourceDescription {
  const { row } = source;
  return {
    kind: row.kind,
    licence: row.licence,
    language: source.language,
    title: row.title ?? null,
    subjectNodeId: source.subjectNodeId,
    examCodes: row.exams,
    classLevel: row.classLevel ?? null,
    year: row.year ?? null,
    setCode: row.setCode ?? null,
    answerKeyForSourceId: links.answerKeyForSourceId,
    parallelGroupId: links.parallelGroupId,
    pageOffset: row.pageOffset ?? null,
    fontHint: row.fontHint ?? null,
    manifestBatchId: links.batchId,
    meta: {
      // The row as written, and what the pipeline needs from it resolved to syllabus ids.
      manifest: row,
      structure: {
        chapter: source.chapter,
        sections: source.sections,
        paperCode: row.paperCode ?? null,
        answerKeyStatus: row.answerKeyStatus ?? null,
      },
    },
  };
}

/**
 * Editions linked by `parallelOf` share a group id. It must come out the same every time the manifest is
 * imported, or re-importing would count as a change: an existing group in the library is reused, otherwise
 * the id is derived from the files' contents.
 */
function parallelGroups(
  sources: readonly PlannedSource[],
  found: ReadonlyMap<string, ManifestFile>,
  library: readonly LibraryFile[],
): { rows: Map<number, string>; library: Map<string, string[]> } {
  const parent = sources.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i]!;
    return i;
  };
  sources.forEach((source, i) => {
    const ref = source.parallelOf;
    if (ref && "row" in ref) parent[root(i)] = root(ref.row);
  });
  const components = new Map<number, { members: number[]; libraryIds: string[] }>();
  sources.forEach((source, i) => {
    const component = components.get(root(i)) ?? { members: [], libraryIds: [] };
    component.members.push(i);
    const ref = source.parallelOf;
    if (ref && "sourceId" in ref) component.libraryIds.push(ref.sourceId);
    components.set(root(i), component);
  });

  const rows = new Map<number, string>();
  const toLink = new Map<string, string[]>();
  for (const { members, libraryIds } of components.values()) {
    if (members.length === 1 && libraryIds.length === 0) continue;
    const linked = library.filter((file) => libraryIds.includes(file.id));
    const shas = members.map((i) => found.get(sources[i]!.row.file)!.sha256);
    const groupId =
      linked.find((file) => file.parallelGroupId)?.parallelGroupId ??
      uuidFromHash(
        createHash("sha256")
          .update([...shas, ...libraryIds].sort().join(","))
          .digest("hex"),
      );
    for (const i of members) rows.set(i, groupId);
    const unlinked = linked.filter((file) => file.parallelGroupId !== groupId).map((file) => file.id);
    if (unlinked.length) toLink.set(groupId, unlinked);
  }
  return { rows, library: toLink };
}

/** A UUID (version 8, "custom") made from a hash, so the same inputs always give the same id. */
function uuidFromHash(hex: string): string {
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
