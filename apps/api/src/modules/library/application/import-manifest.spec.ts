import { describe, expect, it } from "vitest";

import type { LibraryFile, ManifestCatalog } from "../domain/manifest.js";
import {
  ImportManifest,
  type IngestBatches,
  type ManifestFile,
  type ManifestLookup,
} from "./import-manifest.js";
import type { ImportRequest, ImportSource } from "./import-source.js";

const ORG = "0b6f2c1e-0000-4000-8000-000000000001";
const catalog: ManifestCatalog = {
  subjects: new Map([["science", "n-science"]]),
  nodes: new Map([["science/physics/motion", { id: "n-motion", level: "chapter" }]]),
  examCodes: new Set(["rpsc_2g_p2_science"]),
};
const CSV = [
  "file,kind,licence,subject,language,exams,title,paperCode,year,setCode,answerKeyFor,answerKeyStatus,chapter,parallelOf",
  "key.pdf,answer_key,pyq,science,hi,rpsc_2g_p2_science,,p2,2024,A,paper.pdf,final,,",
  "paper.pdf,question_paper,pyq,science,hi,rpsc_2g_p2_science,,p2,2024,A,,,,",
  "motion-en.pdf,notes,own,science,en,rpsc_2g_p2_science,Motion,,,,,,science/physics/motion,motion-hi.pdf",
  "motion-hi.pdf,notes,own,science,hi,rpsc_2g_p2_science,गति,,,,,,science/physics/motion,",
].join("\n");

function setup(library: LibraryFile[] = []) {
  const imported: ImportRequest[] = [];
  const stored: string[] = [];
  const batches: string[] = [];
  const groups: { ids: string[]; group: string }[] = [];
  const importSource = {
    execute: async (request: ImportRequest) => {
      imported.push(request);
      return { status: "started", sourceId: `id-${request.file.filename}` } as const;
    },
  } as unknown as ImportSource;
  const lookup: ManifestLookup = {
    catalog: async () => catalog,
    libraryFiles: async () => library,
    setParallelGroup: async (_org, ids, group) => {
      groups.push({ ids, group });
    },
  };
  const ingestBatches: IngestBatches = {
    create: async (_org, batch) => {
      batches.push(batch.manifestS3Key);
    },
  };
  const store = {
    put: async (key: string) => {
      stored.push(key);
    },
    delete: async () => {},
  };
  const files = (names: string[]) => ({
    find: async (file: string): Promise<ManifestFile | null> =>
      names.includes(file)
        ? {
            path: `/m/${file}`,
            filename: file,
            mimeType: "application/pdf",
            sha256: `sha-${file}`,
            sizeBytes: 1,
          }
        : null,
  });
  const useCase = new ImportManifest(importSource, lookup, ingestBatches, store);
  return { useCase, files, imported, stored, batches, groups };
}

describe("ImportManifest", () => {
  it("imports nothing while the manifest has problems", async () => {
    const { useCase, files, imported, stored } = setup();
    const result = await useCase.execute({
      orgId: ORG,
      requestedBy: null,
      name: "pack/manifest.csv",
      csv: CSV,
      files: files(["paper.pdf", "motion-en.pdf", "motion-hi.pdf"]),
    });
    expect(result).toEqual({
      status: "rejected",
      problems: [{ line: 2, file: "key.pdf", message: "file not found next to the manifest" }],
    });
    expect(imported).toEqual([]);
    expect(stored).toEqual([]);
  });

  it("stores the manifest, imports papers before keys and links editions with a stable group", async () => {
    const run = async () => {
      const { useCase, files, imported, stored, batches } = setup();
      const result = await useCase.execute({
        orgId: ORG,
        requestedBy: null,
        name: "pack/manifest.csv",
        csv: CSV,
        files: files(["key.pdf", "paper.pdf", "motion-en.pdf", "motion-hi.pdf"]),
      });
      return { result, imported, stored, batches };
    };
    const { result, imported, stored, batches } = await run();
    expect(result.status).toBe("imported");
    expect(stored).toEqual(batches);
    expect(stored[0]).toMatch(new RegExp(`^org/${ORG}/manifests/[0-9a-f-]{36}\\.csv$`));

    const byFile = new Map(imported.map((request) => [request.file.filename, request]));
    const order = imported.map((request) => request.file.filename);
    expect(order.indexOf("paper.pdf")).toBeLessThan(order.indexOf("key.pdf"));
    expect(byFile.get("key.pdf")!.description).toMatchObject({
      kind: "answer_key",
      setCode: "A",
      answerKeyForSourceId: "id-paper.pdf",
      meta: { structure: { paperCode: "p2", answerKeyStatus: "final" } },
    });
    expect(byFile.get("motion-en.pdf")!.description).toMatchObject({
      subjectNodeId: "n-science",
      examCodes: ["rpsc_2g_p2_science"],
      meta: { structure: { chapter: { nodeId: "n-motion", path: "science/physics/motion" } } },
    });
    const group = byFile.get("motion-en.pdf")!.description.parallelGroupId;
    expect(group).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(byFile.get("motion-hi.pdf")!.description.parallelGroupId).toBe(group);
    expect(byFile.get("paper.pdf")!.description.parallelGroupId).toBeNull();
    expect(imported.every((request) => request.fromManifest)).toBe(true);

    // Importing the same manifest again describes the files identically, so nothing counts as changed.
    const again = await run();
    expect(again.imported.find((r) => r.file.filename === "motion-hi.pdf")!.description.parallelGroupId).toBe(
      group,
    );
  });

  it("joins an edition already in the library to the new file's group", async () => {
    const { useCase, files, imported, groups } = setup([
      { id: "s-old", filename: "motion-hi.pdf", kind: "notes", setCode: null, parallelGroupId: null },
    ]);
    const csv = [
      "file,kind,licence,subject,language,exams,parallelOf",
      "motion-en.pdf,notes,own,science,en,rpsc_2g_p2_science,old/motion-hi.pdf",
    ].join("\n");
    await useCase.execute({
      orgId: ORG,
      requestedBy: null,
      name: "m.csv",
      csv,
      files: files(["motion-en.pdf"]),
    });
    const group = imported[0]!.description.parallelGroupId!;
    expect(groups).toEqual([{ ids: ["s-old"], group }]);
  });
});
