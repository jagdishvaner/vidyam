import type { NotesDocument, PaperDocument, PaperSlot } from "@vidyam/contracts";
import { describe, expect, it } from "vitest";

import { applyEdits, questionIds } from "./edits.js";

const NODE = "6a3e8a52-6f2c-4bd5-9a43-2b2f3c0f9d11";
const Q = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

function slot(id: string, sectionIndex: number, questionId: string | null): PaperSlot {
  return {
    slotId: id, sectionIndex, qtype: "mcq_single", taxonomyNodeId: NODE, difficulty: 3, marks: 2,
    state: questionId ? "verified" : "insufficient_evidence", questionId, flags: questionId ? [] : ["no material"],
  }; // prettier-ignore
}

function paper(): PaperDocument {
  const slots = [slot("s1-1", 0, Q(1)), slot("s1-2", 0, Q(2)), slot("s1-3", 0, null), slot("s2-1", 1, Q(3))];
  return {
    spec: {
      kind: "question_paper", title: "Force test", examCode: null, blueprintId: null, taxonomyNodeIds: [NODE],
      sections: [], languages: ["hi"], layout: "single_language", durationMinutes: 30, sourcing: "bank_first",
      studentBatchId: null, setCodes: ["A", "B"],
    },
    sections: [
      { name: { en: "MCQ" }, instructions: null, slotIds: ["s1-1", "s1-2", "s1-3"] },
      { name: { en: "Numerical" }, instructions: null, slotIds: ["s2-1"] },
    ],
    slots,
    sets: [
      { code: "A", slotOrder: ["s1-1", "s1-2", "s1-3", "s2-1"], optionOrder: { "s1-1": ["A", "B", "C", "D"] } },
      { code: "B", slotOrder: ["s1-2", "s1-3", "s1-1", "s2-1"], optionOrder: { "s1-1": ["C", "A", "D", "B"] } },
    ],
  }; // prettier-ignore
}

describe("editing a paper", () => {
  it("puts an edited or replacing question in its slot and forgets the old option order", () => {
    const content = { hi: { stem: "प्रश्न", options: [], solution: null }, en: null };
    const edited = applyEdits(paper(), [
      { op: "edit_item", slotId: "s1-1", content, answer: { kind: "unknown" }, questionId: Q(7) },
      { op: "replace_item", slotId: "s1-3", questionId: Q(8), state: "bank" },
    ]) as PaperDocument;
    expect(edited.slots[0]).toMatchObject({ questionId: Q(7), state: "edited", flags: [] });
    expect(edited.slots[2]).toMatchObject({ questionId: Q(8), state: "bank", flags: [] });
    expect(edited.sets.every((set) => !("s1-1" in set.optionOrder))).toBe(true);
    expect(questionIds(edited)).toEqual([Q(7), Q(2), Q(8), Q(3)]);
  });

  it("removes items everywhere and refuses to empty the paper", () => {
    const edited = applyEdits(paper(), [{ op: "delete_items", slotIds: ["s1-1", "s2-1"] }]) as PaperDocument;
    expect(edited.slots.map((s) => s.slotId)).toEqual(["s1-2", "s1-3"]);
    expect(edited.sections.map((s) => s.slotIds)).toEqual([["s1-2", "s1-3"], []]);
    expect(edited.sets[1]).toEqual({ code: "B", slotOrder: ["s1-2", "s1-3"], optionOrder: {} });
    const all = ["s1-1", "s1-2", "s1-3", "s2-1"];
    expect(() => applyEdits(paper(), [{ op: "delete_items", slotIds: all }])).toThrow("at least one item");
    expect(() => applyEdits(paper(), [{ op: "delete_items", slotIds: ["s9"] }])).toThrow("no item s9");
  });

  it("reorders a section, and set A follows the paper while other sets keep their shuffle", () => {
    const edited = applyEdits(paper(), [
      { op: "reorder", slotIds: ["s1-3", "s1-1", "s1-2"] },
    ]) as PaperDocument;
    expect(edited.sections[0]!.slotIds).toEqual(["s1-3", "s1-1", "s1-2"]);
    expect(edited.slots.map((s) => s.slotId)).toEqual(["s1-3", "s1-1", "s1-2", "s2-1"]);
    expect(edited.sets[0]!.slotOrder).toEqual(["s1-3", "s1-1", "s1-2", "s2-1"]);
    expect(edited.sets[1]!.slotOrder).toEqual(["s1-2", "s1-3", "s1-1", "s2-1"]);
    expect(() => applyEdits(paper(), [{ op: "reorder", slotIds: ["s1-1", "s2-1"] }])).toThrow("one section");
  });

  it("adds items after another, changes marks, instructions and the title", () => {
    const edited = applyEdits(paper(), [
      { op: "add_items", afterSlotId: "s1-1", slots: [slot("s1-4", 0, Q(9))] },
      { op: "set_marks", slotId: "s2-1", marks: 4 },
      { op: "set_instructions", sectionIndex: 1, instructions: { en: "Answer in SI units." } },
      { op: "set_title", title: "Force test (revised)" },
    ]) as PaperDocument;
    expect(edited.sections[0]!.slotIds).toEqual(["s1-1", "s1-4", "s1-2", "s1-3"]);
    expect(edited.slots.map((s) => s.slotId)).toEqual(["s1-1", "s1-4", "s1-2", "s1-3", "s2-1"]);
    expect(edited.sets[1]!.slotOrder.at(-1)).toBe("s1-4");
    expect(edited.slots.at(-1)!.marks).toBe(4);
    expect(edited.sections[1]!.instructions).toEqual({ en: "Answer in SI units." });
    expect(edited.spec.title).toBe("Force test (revised)");
  });

  it("never changes the content it was given", () => {
    const before = paper();
    const copy = structuredClone(before);
    applyEdits(before, [{ op: "delete_items", slotIds: ["s1-1"] }]);
    expect(before).toEqual(copy);
  });
});

describe("editing notes", () => {
  const notes: NotesDocument = {
    spec: {
      kind: "notes", title: "Force notes", examCode: null, taxonomyNodeIds: [NODE], languages: ["hi"],
      depth: "brief", includeExamples: false, includePractice: false,
    },
    sections: [
      { nodeId: NODE, title: { en: "Force" }, body: { hi: "बल [1]" }, citations: [], state: "verified", flags: [] },
      { nodeId: Q(5), title: { en: "Motion" }, body: {}, citations: [], state: "insufficient_evidence",
        flags: ["no material"] },
    ],
  }; // prettier-ignore

  it("rewrites and removes sections, and refuses paper edits", () => {
    const edited = applyEdits(notes, [
      { op: "edit_section", nodeId: NODE, body: { hi: "बल एक धक्का या खिंचाव है।" } },
      { op: "delete_sections", nodeIds: [Q(5)] },
    ]) as NotesDocument;
    expect(edited.sections).toHaveLength(1);
    expect(edited.sections[0]).toMatchObject({ body: { hi: "बल एक धक्का या खिंचाव है।" }, state: "edited" });
    expect(() => applyEdits(notes, [{ op: "set_marks", slotId: "s1-1", marks: 1 }])).toThrow("notes");
    expect(() => applyEdits(paper(), [{ op: "delete_sections", nodeIds: [NODE] }])).toThrow("paper");
  });
});
