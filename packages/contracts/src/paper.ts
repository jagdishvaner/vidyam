import { z } from "zod";

import { Language, Uuid } from "./common.js";
import { QuestionType } from "./question.js";
import { contract } from "./registry.js";

/** What a teacher asked for, after the spec card is confirmed. */
export const PaperSpec = contract(
  "PaperSpec",
  z.object({
    examCode: z.string(),
    title: z.string(),
    languages: z.array(Language).min(1),
    layout: z.enum(["hindi_then_english", "side_by_side", "single_language"]),
    durationMinutes: z.number().int().positive(),
    totalMarks: z.number().positive(),
    negativeMarking: z.number().nonnegative(),
    taxonomyNodeIds: z.array(Uuid).min(1),
    sections: z
      .array(
        z.object({
          name: z.string(),
          qtype: QuestionType,
          count: z.number().int().positive(),
          marksEach: z.number().positive(),
          /** Share of easy / medium / hard items; must add up to 1. */
          difficultyMix: z.object({ easy: z.number(), medium: z.number(), hard: z.number() }),
        }),
      )
      .min(1),
    allowPyqReuse: z.boolean(),
    studentBatchId: Uuid.nullable(),
  }),
);
export type PaperSpec = z.infer<typeof PaperSpec>;

/** One position in a paper that generation or the pool must fill. */
export const Slot = contract(
  "Slot",
  z.object({
    id: z.string(),
    sectionIndex: z.number().int().nonnegative(),
    qtype: QuestionType,
    taxonomyNodeId: Uuid,
    difficulty: z.number().int().min(1).max(5),
    marks: z.number().positive(),
  }),
);
export type Slot = z.infer<typeof Slot>;

/** The paper itself: sections of items with stable ids, each pointing at an item-bank question. */
export const PaperDocument = contract(
  "PaperDocument",
  z.object({
    spec: PaperSpec,
    sections: z.array(
      z.object({
        name: z.string(),
        instructions: z.string().nullable(),
        items: z.array(
          z.object({
            itemId: z.string(),
            questionId: Uuid,
            slotId: z.string().nullable(),
            marks: z.number(),
          }),
        ),
      }),
    ),
  }),
);
export type PaperDocument = z.infer<typeof PaperDocument>;
