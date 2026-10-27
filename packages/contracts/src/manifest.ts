import { z } from "zod";

import { Licence, SourceKind } from "./common.js";
import { contract } from "./registry.js";

/** A page range in the file and the syllabus chapter it covers ("12-30" → physics/rotational_motion). */
export const ManifestSection = contract(
  "ManifestSection",
  z.object({
    pages: z.string().regex(/^\d+(-\d+)?$/),
    /** Syllabus code path, e.g. "physics/rotational_motion". */
    chapter: z.string().min(1),
    title: z.string().optional(),
  }),
);
export type ManifestSection = z.infer<typeof ManifestSection>;

/**
 * One file's row in an upload manifest (plan v3 §5). Everything search and generation filter on is captured
 * here, once, so content never has to be uploaded again. Folder-level defaults fill in missing columns.
 */
export const SourceManifestRow = contract(
  "SourceManifestRow",
  z
    .object({
      /** Path of the file relative to the manifest. */
      file: z.string().min(1),
      kind: SourceKind,
      licence: Licence,
      /** Syllabus subject code ("physics"), or "multi" for a file spanning subjects. */
      subject: z.string().min(1),
      language: z.enum(["hi", "en", "bilingual"]),
      exams: z.array(z.string().min(1)).min(1),
      title: z.string().optional(),
      classLevel: z.string().optional(),
      // Question papers
      paperCode: z.string().optional(),
      year: z.number().int().min(1950).max(2100).optional(),
      setCode: z
        .string()
        .regex(/^[A-Z]$/)
        .optional(),
      dateShift: z.string().optional(),
      // Answer keys
      answerKeyFor: z.string().optional(),
      answerKeyStatus: z.enum(["provisional", "final"]).optional(),
      // Structure: a single-chapter file, or page ranges per chapter
      chapter: z.string().optional(),
      sections: z.array(ManifestSection).optional(),
      /** The other-language edition of the same book (its file path). */
      parallelOf: z.string().optional(),
      /** Printed number of the PDF's first page, minus one. */
      pageOffset: z.number().int().optional(),
      fontHint: z.enum(["unicode", "krutidev", "chanakya", "other"]).optional(),
      author: z.string().optional(),
      edition: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .superRefine((row, ctx) => {
      const need = (field: keyof typeof row, why: string) => {
        if (row[field] === undefined)
          ctx.addIssue({ code: "custom", path: [field], message: `required ${why}` });
      };
      if (row.kind === "question_paper") {
        need("paperCode", "for a question paper");
        need("year", "for a question paper");
        need("setCode", "for a question paper (its booklet set)");
      }
      if (row.kind === "answer_key") {
        need("answerKeyFor", "for an answer key (the paper it answers)");
        need("setCode", "for an answer key");
        need("answerKeyStatus", "for an answer key");
      }
      if (row.kind === "book") need("title", "for a book");
    }),
);
export type SourceManifestRow = z.infer<typeof SourceManifestRow>;
