import type {
  DocumentContent,
  EditOp,
  NotesDocument,
  PaperDocument,
  PaperSlot,
  SlotState,
} from "@vidyam/contracts";

import { DomainError } from "../../../shared/kernel/errors.js";

/**
 * An edit operation once the API has done its part: an edited question is saved and has its new id, and a
 * replacing question's standing in the bank decides the item's badge.
 */
export type ResolvedOp =
  | Exclude<EditOp, { op: "edit_item" | "replace_item" }>
  | (Extract<EditOp, { op: "replace_item" }> & { state: SlotState })
  | (Extract<EditOp, { op: "edit_item" }> & { questionId: string });

const PAPER_OPS = new Set([
  "replace_item",
  "delete_items",
  "add_items",
  "reorder",
  "set_marks",
  "set_instructions",
  "set_title",
  "edit_item",
]);
const NOTES_OPS = new Set(["edit_section", "delete_sections", "set_title"]);

export function isPaper(content: DocumentContent): content is PaperDocument {
  return "slots" in content;
}

function invalid(message: string): never {
  throw new DomainError(message, "invalid");
}

/**
 * A document's content after the edits, in order (plan v3 §6.9). Pure: the operations are checked against the
 * content, and the content is never changed in place. `set_title` changes the spec's title; the API renames
 * the document with it.
 */
export function applyEdits(content: DocumentContent, ops: readonly ResolvedOp[]): DocumentContent {
  let next: DocumentContent = structuredClone(content);
  for (const op of ops) {
    if (isPaper(next)) {
      if (!PAPER_OPS.has(op.op)) invalid(`${op.op} doesn't apply to a paper.`);
      next = applyToPaper(next, op);
    } else {
      if (!NOTES_OPS.has(op.op)) invalid(`${op.op} doesn't apply to notes.`);
      next = applyToNotes(next, op);
    }
  }
  return next;
}

function slotOf(paper: PaperDocument, slotId: string): PaperSlot {
  return paper.slots.find((slot) => slot.slotId === slotId) ?? invalid(`There is no item ${slotId}.`);
}

/** Each booklet set's options were shuffled for the old question: the new one prints in its own order. */
function forgetOptionOrder(paper: PaperDocument, slotId: string): void {
  for (const set of paper.sets) delete set.optionOrder[slotId];
}

function applyToPaper(paper: PaperDocument, op: ResolvedOp): PaperDocument {
  switch (op.op) {
    case "replace_item":
    case "edit_item": {
      const slot = slotOf(paper, op.slotId);
      slot.questionId = op.questionId;
      slot.state = op.op === "edit_item" ? "edited" : op.state;
      slot.flags = [];
      forgetOptionOrder(paper, op.slotId);
      return paper;
    }
    case "delete_items": {
      const gone = new Set(op.slotIds);
      for (const id of gone) slotOf(paper, id);
      if (gone.size === paper.slots.length) invalid("A paper needs at least one item.");
      paper.slots = paper.slots.filter((slot) => !gone.has(slot.slotId));
      for (const section of paper.sections) section.slotIds = section.slotIds.filter((id) => !gone.has(id));
      for (const set of paper.sets) {
        set.slotOrder = set.slotOrder.filter((id) => !gone.has(id));
        for (const id of gone) delete set.optionOrder[id];
      }
      return paper;
    }
    case "add_items": {
      const taken = new Set(paper.slots.map((slot) => slot.slotId));
      const after = op.afterSlotId === null ? null : slotOf(paper, op.afterSlotId);
      for (const slot of op.slots) {
        if (taken.has(slot.slotId)) invalid(`There is already an item ${slot.slotId}.`);
        if (!paper.sections[slot.sectionIndex]) invalid(`There is no section ${slot.sectionIndex + 1}.`);
        taken.add(slot.slotId);
      }
      let anchor = after?.slotId ?? null;
      for (const slot of op.slots) {
        const ids = paper.sections[slot.sectionIndex]!.slotIds;
        const at = anchor && ids.includes(anchor) ? ids.indexOf(anchor) + 1 : ids.length;
        ids.splice(at, 0, slot.slotId);
        const position = anchor ? paper.slots.findIndex((s) => s.slotId === anchor) + 1 : paper.slots.length;
        paper.slots.splice(position, 0, structuredClone(slot));
        for (const set of paper.sets) set.slotOrder.push(slot.slotId);
        anchor = slot.slotId;
      }
      return paper;
    }
    case "reorder": {
      const section = paper.sections.find((s) => s.slotIds.includes(op.slotIds[0]!));
      const same =
        section &&
        op.slotIds.length === section.slotIds.length &&
        new Set(op.slotIds).size === op.slotIds.length &&
        op.slotIds.every((id) => section.slotIds.includes(id));
      if (!section || !same) invalid("A new order must list every item of one section once.");
      section.slotIds = [...op.slotIds];
      const order = new Map(paper.sections.flatMap((s) => s.slotIds).map((id, n) => [id, n]));
      paper.slots.sort((a, b) => order.get(a.slotId)! - order.get(b.slotId)!);
      const first = paper.sets.find((set) => set.code === "A");
      if (first) first.slotOrder = paper.sections.flatMap((s) => s.slotIds); // set A prints the paper's order
      return paper;
    }
    case "set_marks":
      slotOf(paper, op.slotId).marks = op.marks;
      return paper;
    case "set_instructions": {
      const section =
        paper.sections[op.sectionIndex] ?? invalid(`There is no section ${op.sectionIndex + 1}.`);
      section.instructions = op.instructions;
      return paper;
    }
    case "set_title":
      paper.spec.title = op.title;
      return paper;
    default:
      return invalid(`${op.op} doesn't apply to a paper.`);
  }
}

function applyToNotes(notes: NotesDocument, op: ResolvedOp): NotesDocument {
  switch (op.op) {
    case "edit_section": {
      const section =
        notes.sections.find((s) => s.nodeId === op.nodeId) ?? invalid("There is no such section.");
      section.body = op.body;
      section.state = "edited";
      section.flags = [];
      return notes;
    }
    case "delete_sections": {
      const gone = new Set(op.nodeIds);
      if (notes.sections.every((s) => gone.has(s.nodeId))) invalid("Notes need at least one section.");
      notes.sections = notes.sections.filter((s) => !gone.has(s.nodeId));
      return notes;
    }
    case "set_title":
      notes.spec.title = op.title;
      return notes;
    default:
      return invalid(`${op.op} doesn't apply to notes.`);
  }
}

/** The question ids a document's slots hold. */
export function questionIds(content: DocumentContent): string[] {
  return isPaper(content) ? content.slots.flatMap((slot) => (slot.questionId ? [slot.questionId] : [])) : [];
}
