import { describe, expect, it } from "vitest";

import {
  ImportSource,
  NO_METADATA,
  type ImportRequest,
  type IngestionStarter,
  type OriginalStore,
  type SourceDescription,
  type SourceRecord,
  type SourceRegistry,
} from "./import-source.js";

const ORG = "0b6f2c1e-0000-4000-8000-000000000001";
const SHA = "a".repeat(64);

function setup(
  existing: { id: string; stage: string; status: string } | null,
  running = false,
  changed = false,
) {
  const calls = {
    stored: [] as string[],
    created: [] as SourceRecord[],
    described: [] as SourceDescription[],
    started: [] as string[],
    stages: [] as string[],
  };
  const registry: SourceRegistry = {
    findBySha256: async () => existing,
    create: async (_org, record) => {
      calls.created.push(record);
      return "new-source";
    },
    describe: async (_org, _id, description) => {
      calls.described.push(description);
      return changed;
    },
  };
  const store: OriginalStore = {
    put: async (key) => {
      calls.stored.push(key);
    },
    delete: async () => {},
  };
  const starter: IngestionStarter = {
    start: async (input) => {
      calls.started.push(input.sourceId);
      calls.stages.push(input.stages);
      return !running;
    },
  };
  return { useCase: new ImportSource(registry, store, starter), calls };
}

const request: ImportRequest = {
  orgId: ORG,
  requestedBy: null,
  file: {
    path: "/tmp/Polity Notes.PDF",
    filename: "Polity Notes.PDF",
    sha256: SHA,
    mimeType: "application/pdf",
    sizeBytes: 10,
  },
  description: { ...NO_METADATA, kind: "notes", licence: "own", language: null, meta: { exam: "rpsc" } },
  fromManifest: false,
};
const fromManifest: ImportRequest = {
  ...request,
  description: { ...request.description, title: "Polity", examCodes: ["rpsc_2g_paper_1"] },
  fromManifest: true,
};

describe("ImportSource", () => {
  it("stores a new file under its content hash, registers it and starts ingestion", async () => {
    const { useCase, calls } = setup(null);
    expect(await useCase.execute(request)).toEqual({ status: "started", sourceId: "new-source" });
    expect(calls.stored).toEqual([`org/${ORG}/originals/${SHA}.pdf`]);
    expect(calls.created[0]).toMatchObject({
      filename: "Polity Notes.PDF",
      kind: "notes",
      meta: { exam: "rpsc" },
    });
    expect(calls.started).toEqual(["new-source"]);
    expect(calls.stages).toEqual(["all"]);
  });

  it("never re-reads a file that was already imported", async () => {
    const { useCase, calls } = setup({ id: "old", stage: "chunked", status: "done" });
    expect(await useCase.execute(request)).toEqual({ status: "already_imported", sourceId: "old" });
    expect(calls).toEqual({ stored: [], created: [], described: [], started: [], stages: [] });
  });

  it("takes a manifest's newer description for a file already imported, and re-tags it", async () => {
    const changed = setup({ id: "old", stage: "tagged", status: "done" }, false, true);
    expect(await changed.useCase.execute(fromManifest)).toEqual({ status: "updated", sourceId: "old" });
    expect(changed.calls.described[0]).toMatchObject({ title: "Polity", examCodes: ["rpsc_2g_paper_1"] });
    expect(changed.calls.stored).toEqual([]);
    expect(changed.calls.stages).toEqual(["structure"]); // the pages stay; sections, chunks, tags redone

    const same = setup({ id: "old", stage: "tagged", status: "done" });
    expect(await same.useCase.execute(fromManifest)).toEqual({
      status: "already_imported",
      sourceId: "old",
    });
    expect(same.calls.started).toEqual([]);
  });

  it("retries a file whose ingestion failed, without storing it again", async () => {
    const { useCase, calls } = setup({ id: "old", stage: "parsed", status: "failed" });
    expect(await useCase.execute(request)).toEqual({ status: "retrying", sourceId: "old" });
    expect(calls.stored).toEqual([]);
    expect(calls.started).toEqual(["old"]);
  });

  it("starts a file that was registered but never picked up, unless it is already running", async () => {
    const waiting = setup({ id: "old", stage: "uploaded", status: "pending" });
    expect(await waiting.useCase.execute(request)).toEqual({ status: "started", sourceId: "old" });
    const running = setup({ id: "old", stage: "uploaded", status: "pending" }, true);
    expect(await running.useCase.execute(request)).toEqual({ status: "in_progress", sourceId: "old" });
  });
});
