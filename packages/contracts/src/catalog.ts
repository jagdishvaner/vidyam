import { z } from "zod";

import { Language, Licence } from "./common.js";
import { contract } from "./registry.js";
import { Blueprint } from "./paper.js";
import { Answer, QuestionContent, QuestionType } from "./question.js";

/**
 * Import formats for what admins load in bulk: exam papers, syllabus trees, paper patterns, the glossary and
 * existing questions. Nodes are referred to by code path, never by id, because ids differ between local,
 * staging and production.
 */

export const NodeCode = z.string().regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, "lowercase words joined by _");

/** A syllabus node by its codes from the subject down: "science/physics/motion/equations_of_motion". */
export const CodePath = contract(
  "CodePath",
  z.string().regex(/^[a-z0-9_]+(\/[a-z0-9_]+)*$/, "codes joined by /, starting at the subject"),
);
export type CodePath = z.infer<typeof CodePath>;

/** One exam paper the center prepares for (an `exams` row): "RPSC 2nd Grade, Paper II, Science". */
export const ExamPaperImport = contract(
  "ExamPaperImport",
  z.object({
    code: NodeCode,
    /** The exam the paper belongs to ("rpsc_2nd_grade"); several papers share a family. */
    family: NodeCode,
    paperCode: z.string().nullable(),
    nameEn: z.string().min(1),
    nameHi: z.string().nullable(),
    /** Which language wins when the Hindi and English versions of a question disagree. */
    authoritativeLanguage: Language,
    /** The syllabus the paper covers, with each part's share of the questions when the pattern fixes it. */
    syllabus: z.array(z.object({ node: CodePath, weightage: z.number().min(0).max(1).optional() })).min(1),
  }),
);
export type ExamPaperImport = z.infer<typeof ExamPaperImport>;

export const SyllabusLevel = contract(
  "SyllabusLevel",
  z.enum(["subject", "unit", "chapter", "topic", "subtopic"]),
);
export type SyllabusLevel = z.infer<typeof SyllabusLevel>;

const SyllabusNodeFields = z.object({
  code: NodeCode,
  level: SyllabusLevel,
  nameEn: z.string().min(1),
  nameHi: z.string().min(1).nullable(),
  /** Spellings teachers actually type, including Hinglish ("newton ke niyam"). */
  aliases: z.array(z.string().min(1)).default([]),
  /** Learning objectives; they double as retrieval queries for the node. */
  objectives: z.array(z.string().min(1)).default([]),
});
export type SyllabusNodeImport = z.infer<typeof SyllabusNodeFields> & { children: SyllabusNodeImport[] };

/** A syllabus tree node and everything below it. */
export const SyllabusNodeImport: z.ZodType<SyllabusNodeImport, z.input<typeof SyllabusNodeFields> & object> =
  contract(
    "SyllabusNodeImport",
    SyllabusNodeFields.extend({
      get children() {
        return z.array(SyllabusNodeImport).default([]);
      },
    }),
  );

/** One subject's tree, from the subject down to topics. Importing it again updates nodes in place by code. */
export const SyllabusImport = contract(
  "SyllabusImport",
  z.object({ subject: SyllabusNodeImport }).refine((s) => s.subject.level === "subject", {
    message: "the root of a syllabus is a subject",
    path: ["subject", "level"],
  }),
);
export type SyllabusImport = z.infer<typeof SyllabusImport>;

/** A paper pattern for one exam paper (an `exam_blueprints` row). */
export const BlueprintImport = contract(
  "BlueprintImport",
  z.object({ exam: NodeCode, name: z.string().min(1), blueprint: Blueprint }),
);
export type BlueprintImport = z.infer<typeof BlueprintImport>;

/** One approved Hindi ↔ English term pair, used to keep bilingual questions consistent. */
export const GlossaryTermImport = contract(
  "GlossaryTermImport",
  z.object({ en: z.string().min(1), hi: z.string().min(1), subject: NodeCode }),
);
export type GlossaryTermImport = z.infer<typeof GlossaryTermImport>;

/** A question the center already has, loaded into the bank as `imported`. */
export const QuestionImport = contract(
  "QuestionImport",
  z.object({
    /** Stable id within the import ("demo-motion-007"), so loading the same file twice changes nothing. */
    ref: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    qtype: QuestionType,
    content: QuestionContent,
    answer: Answer,
    authoritativeLanguage: Language,
    difficulty: z.number().int().min(1).max(5),
    marks: z.number().positive().nullable(),
    negativeMarks: z.number().nonnegative().nullable(),
    /** Syllabus nodes the question tests; the first is its primary topic. */
    taxonomy: z.array(CodePath).min(1),
    licence: Licence,
  }),
);
export type QuestionImport = z.infer<typeof QuestionImport>;
