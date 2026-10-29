import { z } from "zod";

import { Language, Licence, Uuid } from "./common.js";
import { contract } from "./registry.js";

export const QuestionType = contract(
  "QuestionType",
  z.enum([
    "mcq_single",
    "mcq_multi",
    "numerical",
    "integer",
    "assertion_reason",
    "match_columns",
    "statement",
    "passage",
    "short_answer",
    "long_answer",
  ]),
);
export type QuestionType = z.infer<typeof QuestionType>;

export const QuestionStatus = contract(
  "QuestionStatus",
  z.enum(["draft", "verified", "flagged", "approved", "published", "retired"]),
);
export type QuestionStatus = z.infer<typeof QuestionStatus>;

/** Imported from a paper, generated from the material, a pool top-up, or written (or reworded) by a teacher. */
export const QuestionOrigin = contract(
  "QuestionOrigin",
  z.enum(["imported", "generated", "pool", "teacher"]),
);
export type QuestionOrigin = z.infer<typeof QuestionOrigin>;

export const QuestionOption = contract(
  "QuestionOption",
  z.object({ key: z.string().min(1).max(4), text: z.string() }),
);
export type QuestionOption = z.infer<typeof QuestionOption>;

/** Text of a question in one language. Math is LaTeX, chemistry is mhchem, figures are referenced by asset id. */
export const QuestionText = contract(
  "QuestionText",
  z.object({
    stem: z.string().min(1),
    options: z.array(QuestionOption),
    solution: z.string().nullable(),
  }),
);
export type QuestionText = z.infer<typeof QuestionText>;

/** Hindi and English versions live in one item; at least one is required. */
export const QuestionContent = contract(
  "QuestionContent",
  z
    .object({ hi: QuestionText.nullable(), en: QuestionText.nullable() })
    .refine((c) => c.hi !== null || c.en !== null, "at least one language version is required"),
);
export type QuestionContent = z.infer<typeof QuestionContent>;

export const Answer = contract(
  "Answer",
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("options"), keys: z.array(z.string()).min(1) }),
    z.object({ kind: z.literal("numeric"), value: z.number(), tolerance: z.number().nonnegative() }),
    z.object({ kind: z.literal("text"), modelAnswer: z.string() }),
    /** Imported from a paper whose answer key hasn't arrived: such a question stays a draft. */
    z.object({ kind: z.literal("unknown") }),
  ]),
);
export type Answer = z.infer<typeof Answer>;

export const Question = contract(
  "Question",
  z.object({
    id: Uuid,
    orgId: Uuid,
    qtype: QuestionType,
    origin: QuestionOrigin,
    status: QuestionStatus,
    content: QuestionContent,
    authoritativeLanguage: Language,
    answer: Answer,
    marks: z.number().nullable(),
    negativeMarks: z.number().nullable(),
    difficulty: z.number().int().min(1).max(5).nullable(),
    taxonomyNodeIds: z.array(Uuid),
    figureAssetIds: z.array(Uuid),
    licence: Licence,
    /** Generated items: the evidence chunk ids they cite. Imported items: empty. */
    sourceChunkIds: z.array(Uuid),
  }),
);
export type Question = z.infer<typeof Question>;
