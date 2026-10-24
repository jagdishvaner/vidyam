import { describe, expect, it } from "vitest";

import { buildContractsDocument } from "../scripts/export-json-schema.js";
import { QuestionContent, jobId } from "../src/index.js";

describe("contracts", () => {
  it("exports every contract with resolvable references", () => {
    const doc = buildContractsDocument();
    const defs = doc.$defs as Record<string, unknown>;
    expect(Object.keys(defs)).toEqual(
      expect.arrayContaining(["Question", "PaperSpec", "PaperDocument", "ProgressEvent", "IngestSourceJob"]),
    );
    const refs = JSON.stringify(doc).match(/"\$ref":"#\/\$defs\/([A-Za-z]+)"/g) ?? [];
    for (const ref of refs) {
      const id = ref.split("/").pop()!.replace('"', "");
      expect(defs, `dangling $ref ${id}`).toHaveProperty(id);
    }
  });

  it("export is deterministic", () => {
    expect(JSON.stringify(buildContractsDocument())).toBe(JSON.stringify(buildContractsDocument()));
  });

  it("a question needs at least one language version", () => {
    expect(QuestionContent.safeParse({ hi: null, en: null }).success).toBe(false);
    const en = { stem: "2 + 2 = ?", options: [{ key: "A", text: "4" }], solution: null };
    expect(QuestionContent.safeParse({ hi: null, en }).success).toBe(true);
  });

  it("job ids are idempotent and BullMQ-safe", () => {
    const id = jobId("ingest_source", "0b6f2c1e-0000-4000-8000-000000000000", "parse");
    expect(id).toBe(jobId("ingest_source", "0b6f2c1e-0000-4000-8000-000000000000", "parse"));
    expect(id).not.toContain(":");
  });
});
