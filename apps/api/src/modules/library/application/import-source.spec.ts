import { describe, expect, it } from "vitest";

import {
  ImportSource,
  type ImportRequest,
  type IngestionStarter,
  type OriginalStore,
  type SourceRecord,
  type SourceRegistry,
} from "./import-source.js";

const ORG = "0b6f2c1e-0000-4000-8000-000000000001";
const SHA = "a".repeat(64);

function setup(existing: { id: string; stage: string; status: string } | null, running = false) {
  const calls = { stored: [] as string[], created: [] as SourceRecord[], started: [] as string[] };
  const registry: SourceRegistry = {
    findBySha256: async () => existing,
    create: async (_org, record) => {
      calls.created.push(record);
      return "new-source";
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
  kind: "notes",
  licence: "own",
  language: null,
  meta: { exam: "rpsc" },
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
  });

  it("never re-reads a file that was already imported", async () => {
    const { useCase, calls } = setup({ id: "old", stage: "chunked", status: "done" });
    expect(await useCase.execute(request)).toEqual({ status: "already_imported", sourceId: "old" });
    expect(calls).toEqual({ stored: [], created: [], started: [] });
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
