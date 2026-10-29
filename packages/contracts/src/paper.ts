import { z } from "zod";

import { Uuid } from "./common.js";
import { NotesSection } from "./notes.js";
import { Answer, QuestionContent, QuestionType } from "./question.js";
import { contract } from "./registry.js";
import { DifficultyMix, LocalizedText, PaperSection, PaperSpec } from "./tasks.js";

/** An exam paper's pattern (exam_blueprints.spec): what a paper for it must look like. */
export const Blueprint = contract(
  "Blueprint",
  z.object({
    sections: z.array(PaperSection).min(1),
    durationMinutes: z.number().int().positive(),
    instructions: LocalizedText,
    defaultDifficultyMix: DifficultyMix,
  }),
);
export type Blueprint = z.infer<typeof Blueprint>;

/** Where one position in a paper stands while it is being filled. */
export const SlotState = contract(
  "SlotState",
  z.enum(["pending", "bank", "generated", "verified", "flagged", "insufficient_evidence", "edited"]),
);
export type SlotState = z.infer<typeof SlotState>;

/** One position in a paper: what it needs, and the question that fills it once there is one. */
export const PaperSlot = contract(
  "PaperSlot",
  z.object({
    slotId: z.string(),
    sectionIndex: z.number().int().nonnegative(),
    qtype: QuestionType,
    taxonomyNodeId: Uuid,
    difficulty: z.number().int().min(1).max(5),
    marks: z.number().positive(),
    state: SlotState,
    questionId: Uuid.nullable(),
    /** Why a check failed or evidence was missing, shown on the item's badge. */
    flags: z.array(z.string()).default([]),
  }),
);
export type PaperSlot = z.infer<typeof PaperSlot>;

/** A booklet set: the same questions in a different order, with shuffled options and its own key. */
export const PaperSet = contract(
  "PaperSet",
  z.object({
    code: z.string().regex(/^[A-Z]$/),
    slotOrder: z.array(z.string()),
    /** Per slot: option keys in the order printed in this set. */
    optionOrder: z.record(z.string(), z.array(z.string())),
  }),
);
export type PaperSet = z.infer<typeof PaperSet>;

/** The paper itself (documents.content for papers and worksheets). Questions live in the item bank. */
export const PaperDocument = contract(
  "PaperDocument",
  z.object({
    spec: PaperSpec,
    sections: z.array(
      z.object({ name: LocalizedText, instructions: LocalizedText.nullable(), slotIds: z.array(z.string()) }),
    ),
    slots: z.array(PaperSlot),
    sets: z.array(PaperSet),
  }),
);
export type PaperDocument = z.infer<typeof PaperDocument>;

/** One change to a paper, from the edit-by-chat agent or the teacher's own hands on the canvas. */
export const EditOp = contract(
  "EditOp",
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("replace_item"), slotId: z.string(), questionId: Uuid }),
    z.object({ op: z.literal("delete_items"), slotIds: z.array(z.string()).min(1) }),
    z.object({
      op: z.literal("add_items"),
      afterSlotId: z.string().nullable(),
      slots: z.array(PaperSlot).min(1),
    }),
    z.object({ op: z.literal("reorder"), slotIds: z.array(z.string()).min(1) }),
    z.object({ op: z.literal("set_marks"), slotId: z.string(), marks: z.number().positive() }),
    z.object({
      op: z.literal("set_instructions"),
      sectionIndex: z.number().int().nonnegative(),
      instructions: LocalizedText,
    }),
    z.object({ op: z.literal("set_title"), title: z.string().min(1) }),
    /** The teacher's own wording of a question: saved as a new question in the bank, put in the slot. */
    z.object({ op: z.literal("edit_item"), slotId: z.string(), content: QuestionContent, answer: Answer }),
    /** Notes: a section's text in the teacher's words. */
    z.object({ op: z.literal("edit_section"), nodeId: Uuid, body: LocalizedText }),
    z.object({ op: z.literal("delete_sections"), nodeIds: z.array(Uuid).min(1) }),
    /** Notes: a section written again (by the chat's agent), sources and all. */
    z.object({ op: z.literal("replace_section"), section: NotesSection }),
  ]),
);
export type EditOp = z.infer<typeof EditOp>;

/**
 * A batch of changes made against one version. The API applies it only if that is still the current
 * version, so an edit never silently overwrites someone else's.
 */
export const DocumentEdit = contract(
  "DocumentEdit",
  z.object({ documentId: Uuid, baseVersion: z.number().int().nonnegative(), ops: z.array(EditOp).min(1) }),
);
export type DocumentEdit = z.infer<typeof DocumentEdit>;
