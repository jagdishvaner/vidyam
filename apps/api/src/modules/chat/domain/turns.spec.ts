import { describe, expect, it } from "vitest";

import { assistantMessageId, cardRefs, cardSummary, userBlocks } from "./turns.js";

const MOTION = "0b6f2c1e-0000-4000-8000-0000000000a1";
const names = {
  exams: { rpsc_2g_p2_science: "RPSC Senior Teacher (2nd Grade), Paper II: Science" },
  nodes: { [MOTION]: "Laws of Motion" },
  blueprints: {},
};

describe("a teacher's message", () => {
  it("reads an answered card as a sentence, for any model to follow", () => {
    const values = {
      exam: "rpsc_2g_p2_science",
      taxonomy_nodes: [MOTION],
      languages: ["hi", "en"],
      difficulty_mix: { easy: 0.3, medium: 0.5, hard: 0.2 },
      sections: [{ qtype: "mcq_single", count: 40, marksEach: 2 }],
      duration: 90,
      include_examples: true,
      unknown_field: "ignored",
    };
    expect(cardSummary(values, names)).toBe(
      "Exam: RPSC Senior Teacher (2nd Grade), Paper II: Science. Chapters and topics: Laws of Motion. " +
        "Languages: Hindi, English. Difficulty: 30% easy, 50% medium, 20% hard. " +
        "Sections: 40 mcq single (2 marks each). Duration: 90 minutes. Worked examples: yes",
    );
    expect(cardRefs(values)).toEqual({
      examCodes: ["rpsc_2g_p2_science"],
      nodeIds: [MOTION],
      blueprintIds: [],
    });
    expect(cardRefs({ taxonomy_nodes: ["not-an-id"] }).nodeIds).toEqual([]);
  });

  it("keeps words, cards and buttons as their own blocks", () => {
    const none = { exams: {}, nodes: {}, blueprints: {} };
    expect(userBlocks({ kind: "text", text: "hello" }, none)).toEqual([{ type: "text", text: "hello" }]);
    expect(userBlocks({ kind: "card_submit", cardId: "scope:1", values: { duration: null } }, none)).toEqual([
      { type: "card_response", cardId: "scope:1", values: { duration: null }, summary: "Duration: no limit" },
    ]);
    expect(userBlocks({ kind: "action", action: "confirm_spec" }, none)).toEqual([
      { type: "action", action: "confirm_spec", targetId: null, summary: "Confirm" },
    ]);
  });

  it("gives each turn's answer an id of its own, the same every time", () => {
    const id = assistantMessageId(MOTION);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(assistantMessageId(MOTION)).toBe(id);
  });
});
