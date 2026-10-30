import type { NotesDocument, OrgBranding, PaperDocument } from "@vidyam/contracts";
import { describe, expect, it } from "vitest";

import { printDocument, type PrintPaper, type PrintQuestion } from "./print.js";

const NODE = "6a3e8a52-6f2c-4bd5-9a43-2b2f3c0f9d11";
const Q1 = "00000000-0000-4000-8000-000000000001";
const Q2 = "00000000-0000-4000-8000-000000000002";

const paper: PaperDocument = {
  spec: {
    kind: "question_paper", title: "Force test", examCode: "rpsc", blueprintId: null, taxonomyNodeIds: [NODE],
    sections: [{ name: { en: "Multiple choice", hi: "बहुविकल्पीय" }, qtype: "mcq_single", count: 2, marksEach: 2,
                 negativeMarks: 0.67, attemptAny: null, difficultyMix: { easy: 1, medium: 0, hard: 0 }, scope: [] }],
    languages: ["hi", "en"], layout: "hindi_then_english", durationMinutes: 10, sourcing: "bank_first",
    studentBatchId: null, setCodes: ["A", "B"],
  },
  sections: [{ name: { en: "Multiple choice", hi: "बहुविकल्पीय" }, instructions: null, slotIds: ["s1-1", "s1-2"] }],
  slots: [
    { slotId: "s1-1", sectionIndex: 0, qtype: "mcq_single", taxonomyNodeId: NODE, difficulty: 2, marks: 2,
      state: "verified", questionId: Q1, flags: [] },
    { slotId: "s1-2", sectionIndex: 0, qtype: "mcq_single", taxonomyNodeId: NODE, difficulty: 2, marks: 2,
      state: "insufficient_evidence", questionId: null, flags: [] },
  ],
  sets: [
    { code: "A", slotOrder: ["s1-1", "s1-2"], optionOrder: { "s1-1": ["A", "B", "C", "D"] } },
    { code: "B", slotOrder: ["s1-2", "s1-1"], optionOrder: { "s1-1": ["C", "A", "D", "B"] } },
  ],
}; // prettier-ignore

const questions: Record<string, PrintQuestion> = {
  [Q1]: {
    qtype: "mcq_single",
    content: {
      hi: { stem: "बल का SI मात्रक?", options: ["न्यूटन", "जूल", "वाट", "पास्कल"].map((text, n) => ({ key: "ABCD"[n]!, text })),
            solution: "$F = ma$" },
      en: { stem: "SI unit of force?", options: ["newton", "joule", "watt", "pascal"].map((text, n) => ({ key: "ABCD"[n]!, text })),
            solution: null },
    },
    answer: { kind: "options", keys: ["A"] },
  },
  [Q2]: { qtype: "numerical", content: { hi: null, en: { stem: "g = ?", options: [], solution: null } },
          answer: { kind: "numeric", value: 9.8, tolerance: 0.1 } },
}; // prettier-ignore

const branding: OrgBranding = {
  name: { en: "Vidyam Coaching", hi: "विद्यम कोचिंग" },
  logoKey: null,
  headerLines: { en: "Jaipur" },
  footer: null,
  defaultInstructions: { hi: "सभी प्रश्न अनिवार्य हैं।", en: "All questions are compulsory." },
};

describe("printDocument", () => {
  it("prints a booklet set in its own order, with its option order and key", () => {
    const printed = printDocument({ content: paper, questions, branding, examName: "RPSC II", variant: "paper",
                                    setCode: "B" }) as PrintPaper; // prettier-ignore
    expect(printed.headerLines).toEqual(["विद्यम कोचिंग / Vidyam Coaching", "Jaipur"]);
    expect(printed.facts).toEqual([
      "परीक्षा / Exam: RPSC II", "सेट / Set: B", "समय / Time: 10 मिनट / minutes",
      "पूर्णांक / Maximum marks: 4", "प्रश्न / Questions: 2",
    ]); // prettier-ignore
    expect(printed.instructions).toEqual(["सभी प्रश्न अनिवार्य हैं।", "All questions are compulsory."]);
    const [section] = printed.sections;
    expect(section!.title).toBe("बहुविकल्पीय / Multiple choice");
    expect(section!.note).toBe("2 अंक प्रत्येक / marks each · ऋणात्मक / negative 0.67");
    expect(section!.items.map((item) => [item.number, item.versions.length])).toEqual([
      [1, 0],
      [2, 2],
    ]);
    const second = section!.items[1]!;
    expect(second.versions[0]!.options.map((o) => `${o.label}:${o.text}`)).toEqual([
      "A:वाट", "B:न्यूटन", "C:पास्कल", "D:जूल",
    ]); // prettier-ignore
    expect(second.answer).toBe("B"); // न्यूटन prints second in set B
  });

  it("names the answer key and solutions, and keeps the paper's own keys without a set", () => {
    const key = printDocument({ content: paper, questions, branding: null, examName: null,
                                variant: "answer_key", setCode: null }) as PrintPaper; // prettier-ignore
    expect(key.title).toBe("Force test — उत्तर कुंजी / Answer key");
    expect(key.headerLines).toEqual([]);
    expect(key.instructions).toEqual([]);
    expect(key.sections[0]!.items[0]!.answer).toBe("A");
  });

  it("prints notes with their sources", () => {
    const notes: NotesDocument = {
      spec: { kind: "notes", title: "Force notes", examCode: null, taxonomyNodeIds: [NODE], languages: ["hi"],
              depth: "brief", includeExamples: false, includePractice: false },
      sections: [
        { nodeId: NODE, title: { en: "Force", hi: "बल" }, body: { hi: "बल एक धक्का है [1]।" }, state: "verified",
          flags: [], citations: [{ chunkId: Q1, sourceId: Q2, filename: "force.pdf", pageStart: 5, pageEnd: 5,
                                   pageLabel: "42", quote: "" }] },
        { nodeId: Q1, title: { en: "Motion" }, body: {}, citations: [], state: "insufficient_evidence", flags: [] },
      ],
    }; // prettier-ignore
    const printed = printDocument({ content: notes, questions: {}, branding: null, examName: null, variant: "paper",
                                    setCode: null }); // prettier-ignore
    expect(printed).toMatchObject({
      kind: "notes",
      title: "Force notes",
      sections: [{ title: "बल", bodies: [{ language: "hi", markdown: "बल एक धक्का है [1]।" }],
                   sources: ["[1] force.pdf, p. 42"] }],
    }); // prettier-ignore
  });
});
