import { describe, expect, it } from "vitest";

import { buildContractsDocument } from "../scripts/export-json-schema.js";
import { ChatBlock, QuestionContent, roleCan, SourceManifestRow, workflowId } from "../src/index.js";

describe("contracts", () => {
  it("exports every contract with resolvable references", () => {
    const doc = buildContractsDocument();
    const defs = doc.$defs as Record<string, unknown>;
    expect(Object.keys(defs)).toEqual(
      expect.arrayContaining([
        "Question",
        "PaperSpec",
        "PaperDocument",
        "ProgressEvent",
        "IngestSourceInput",
      ]),
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

  it("workflow ids are deterministic, so the same work is never started twice", () => {
    const id = workflowId("IngestSource", "0b6f2c1e-0000-4000-8000-000000000000");
    expect(id).toBe(workflowId("IngestSource", "0b6f2c1e-0000-4000-8000-000000000000"));
    expect(id).toBe("IngestSource:0b6f2c1e-0000-4000-8000-000000000000");
  });

  it("a manifest row must carry what its kind needs, so nothing is uploaded twice", () => {
    const base = {
      file: "rpsc/2024-a.pdf",
      licence: "pyq",
      subject: "science",
      language: "bilingual",
      exams: ["RPSC_2G"],
    };
    const missing = SourceManifestRow.safeParse({ ...base, kind: "question_paper", year: 2024 });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues.map((i) => i.path[0])).toEqual(["paperCode", "setCode"]);
    expect(
      SourceManifestRow.safeParse({
        ...base,
        kind: "question_paper",
        year: 2024,
        paperCode: "P2",
        setCode: "A",
      }).success,
    ).toBe(true);
  });

  it("chat blocks are told apart by their type", () => {
    expect(ChatBlock.parse({ type: "text", text: "Which chapters?" })).toEqual({
      type: "text",
      text: "Which chapters?",
    });
    expect(
      ChatBlock.safeParse({ type: "clarification", cardId: "c1", purpose: "scope", fields: [] }).success,
    ).toBe(false);
  });

  it("roles can do what the matrix says, and nothing else", () => {
    expect(roleCan("teacher", "document", "export")).toBe(true);
    expect(roleCan("teacher", "library", "remove")).toBe(false);
    expect(roleCan("reviewer", "question", "approve")).toBe(true);
    expect(roleCan("content_operator", "library", "remove")).toBe(true);
    expect(roleCan("content_operator", "document", "create")).toBe(false);
    expect(roleCan("admin", "audit", "read")).toBe(true);
    expect(roleCan(null, "chat", "use")).toBe(false);
  });
});
