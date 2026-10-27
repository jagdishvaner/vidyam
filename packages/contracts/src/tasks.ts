import { z } from "zod";

import { Language, Uuid } from "./common.js";
import { QuestionType } from "./question.js";
import { contract } from "./registry.js";

/** Text in both languages; either may be missing (a Hindi-only exam has no English instructions). */
export const LocalizedText = contract(
  "LocalizedText",
  z.object({ en: z.string().optional(), hi: z.string().optional() }),
);
export type LocalizedText = z.infer<typeof LocalizedText>;

/** What a teacher can ask the chat to create (plan v3: papers, worksheets, notes, revision sheets). */
export const TaskKind = contract(
  "TaskKind",
  z.enum(["question_paper", "worksheet", "notes", "revision_sheet"]),
);
export type TaskKind = z.infer<typeof TaskKind>;

/** Share of easy / medium / hard questions; the three add up to 1. */
export const DifficultyMix = contract(
  "DifficultyMix",
  z.object({
    easy: z.number().min(0).max(1),
    medium: z.number().min(0).max(1),
    hard: z.number().min(0).max(1),
  }),
);
export type DifficultyMix = z.infer<typeof DifficultyMix>;

/** Where questions come from: the center's bank first (cheapest, already checked), only fresh, or only bank. */
export const Sourcing = contract("Sourcing", z.enum(["bank_first", "fresh_only", "bank_only"]));
export type Sourcing = z.infer<typeof Sourcing>;

export const PaperLayout = contract(
  "PaperLayout",
  z.enum(["hindi_then_english", "side_by_side", "single_language"]),
);
export type PaperLayout = z.infer<typeof PaperLayout>;

export const PaperSection = contract(
  "PaperSection",
  z.object({
    name: LocalizedText,
    qtype: QuestionType,
    count: z.number().int().positive(),
    marksEach: z.number().positive(),
    negativeMarks: z.number().nonnegative().default(0),
    /** "Attempt any N of these" sections. */
    attemptAny: z.number().int().positive().nullable().default(null),
    difficultyMix: DifficultyMix,
    /**
     * Syllabus code paths this section draws from ("physics" for JEE's Physics section); empty means the whole
     * paper's syllabus.
     */
    scope: z.array(z.string().regex(/^[a-z0-9_]+(\/[a-z0-9_]+)*$/)).default([]),
  }),
);
export type PaperSection = z.infer<typeof PaperSection>;

/** A question paper or worksheet, as confirmed on the spec review card. */
export const PaperSpec = contract(
  "PaperSpec",
  z.object({
    kind: z.enum(["question_paper", "worksheet"]),
    title: z.string().min(1),
    examCode: z.string().nullable(),
    blueprintId: Uuid.nullable(),
    /** Chapters and topics to draw from (descendants included). */
    taxonomyNodeIds: z.array(Uuid).min(1),
    sections: z.array(PaperSection).min(1),
    languages: z.array(Language).min(1),
    layout: PaperLayout,
    durationMinutes: z.number().int().positive().nullable(),
    sourcing: Sourcing,
    /** Avoid questions these students have already seen. */
    studentBatchId: Uuid.nullable(),
    /** Booklet sets with shuffled questions and options (["A", "B", "C", "D"]); one set if empty. */
    setCodes: z
      .array(z.string().regex(/^[A-Z]$/))
      .max(8)
      .default([]),
  }),
);
export type PaperSpec = z.infer<typeof PaperSpec>;

/** Chapter notes or a revision sheet built from the center's material. */
export const NotesSpec = contract(
  "NotesSpec",
  z.object({
    kind: z.enum(["notes", "revision_sheet"]),
    title: z.string().min(1),
    examCode: z.string().nullable(),
    taxonomyNodeIds: z.array(Uuid).min(1),
    languages: z.array(Language).min(1),
    depth: z.enum(["brief", "standard", "detailed"]),
    includeExamples: z.boolean(),
    /** A few practice questions at the end of each topic. */
    includePractice: z.boolean(),
  }),
);
export type NotesSpec = z.infer<typeof NotesSpec>;

export const TaskSpec = contract("TaskSpec", z.union([PaperSpec, NotesSpec]));
export type TaskSpec = z.infer<typeof TaskSpec>;

/** What the chat has gathered so far: any field may still be missing until the spec is confirmed. */
export const DraftSpec = contract(
  "DraftSpec",
  z.object({
    kind: TaskKind.optional(),
    title: z.string().optional(),
    examCode: z.string().nullable().optional(),
    blueprintId: Uuid.nullable().optional(),
    taxonomyNodeIds: z.array(Uuid).optional(),
    sections: z.array(PaperSection).optional(),
    languages: z.array(Language).optional(),
    layout: PaperLayout.optional(),
    durationMinutes: z.number().int().positive().nullable().optional(),
    sourcing: Sourcing.optional(),
    studentBatchId: Uuid.nullable().optional(),
    setCodes: z.array(z.string()).optional(),
    depth: z.enum(["brief", "standard", "detailed"]).optional(),
    includeExamples: z.boolean().optional(),
    includePractice: z.boolean().optional(),
  }),
);
export type DraftSpec = z.infer<typeof DraftSpec>;
