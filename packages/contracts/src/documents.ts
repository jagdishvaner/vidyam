import { z } from "zod";

import { GenerationProgress } from "./chat.js";
import { Uuid } from "./common.js";
import { NotesSection } from "./notes.js";
import { EditOp, PaperDocument } from "./paper.js";
import { Answer, QuestionContent, QuestionOrigin, QuestionStatus, QuestionType } from "./question.js";
import { contract } from "./registry.js";
import { CitationRef } from "./sources.js";
import { LocalizedText, NotesSpec, TaskKind } from "./tasks.js";

/** Notes or a revision sheet (documents.content for those kinds). */
export const NotesDocument = contract(
  "NotesDocument",
  z.object({ spec: NotesSpec, sections: z.array(NotesSection) }),
);
export type NotesDocument = z.infer<typeof NotesDocument>;

/** What a document holds: a paper (or worksheet), or notes (or a revision sheet). */
export const DocumentContent = contract("DocumentContent", z.union([PaperDocument, NotesDocument]));
export type DocumentContent = z.infer<typeof DocumentContent>;

export const DocumentSummary = contract(
  "DocumentSummary",
  z.object({
    id: Uuid,
    kind: TaskKind,
    title: z.string(),
    /** 0 while the first version is being made. */
    currentVersion: z.number().int().nonnegative(),
    updatedAt: z.iso.datetime({ offset: true }),
  }),
);
export type DocumentSummary = z.infer<typeof DocumentSummary>;

/** A teacher's document in a list, with the chat it was made in (where it opens). */
export const DocumentListItem = contract(
  "DocumentListItem",
  DocumentSummary.extend({ chatId: Uuid.nullable() }),
);
export type DocumentListItem = z.infer<typeof DocumentListItem>;

export const DocumentListQuery = contract(
  "DocumentListQuery",
  z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }),
);
export type DocumentListQuery = z.infer<typeof DocumentListQuery>;

/** A question as the canvas shows it: its text and key, where it stands in the bank, and what it rests on. */
export const CanvasQuestion = contract(
  "CanvasQuestion",
  z.object({
    id: Uuid,
    qtype: QuestionType,
    origin: QuestionOrigin,
    status: QuestionStatus,
    content: QuestionContent,
    answer: Answer,
    difficulty: z.number().int().min(1).max(5).nullable(),
    /** What the checks found: fast checks, grounding, the re-solve. */
    verification: z.record(z.string(), z.unknown()),
    /** The passages of the center's material it was written from. */
    sources: z.array(CitationRef),
  }),
);
export type CanvasQuestion = z.infer<typeof CanvasQuestion>;

/** A document on the canvas: its current version, or while the first is being made, the run's live slots. */
export const DocumentDetail = contract(
  "DocumentDetail",
  z.object({
    document: DocumentSummary,
    content: DocumentContent,
    /** The questions the slots hold, by id. */
    questions: z.record(z.string(), CanvasQuestion),
    /** Syllabus names of the chapters and topics the content is about, by id. */
    nodeNames: z.record(z.string(), LocalizedText),
    generation: GenerationProgress.nullable(),
  }),
);
export type DocumentDetail = z.infer<typeof DocumentDetail>;

export const DocumentVersionSummary = contract(
  "DocumentVersionSummary",
  z.object({
    version: z.number().int().positive(),
    /** Vidyam made it (agent), a teacher changed it (user), or it was restored (system). */
    authorKind: z.enum(["user", "agent", "system"]),
    authorName: z.string().nullable(),
    /** What changed from the version before: the edit operations' names ("edit_item", "restore", …). */
    changes: z.array(z.string()),
    createdAt: z.iso.datetime({ offset: true }),
  }),
);
export type DocumentVersionSummary = z.infer<typeof DocumentVersionSummary>;

export const DocumentVersion = contract(
  "DocumentVersion",
  z.object({ version: z.number().int().positive(), content: DocumentContent }),
);
export type DocumentVersion = z.infer<typeof DocumentVersion>;

/** Changes made on the canvas against the version they were made on (no lost edits). */
export const DocumentEditRequest = contract(
  "DocumentEditRequest",
  z.object({ baseVersion: z.number().int().positive(), ops: z.array(EditOp).min(1).max(100) }),
);
export type DocumentEditRequest = z.infer<typeof DocumentEditRequest>;

/** Undo: an earlier version becomes the newest one again; history is never rewritten. */
export const DocumentRestoreRequest = contract(
  "DocumentRestoreRequest",
  z.object({ baseVersion: z.number().int().positive(), version: z.number().int().positive() }),
);
export type DocumentRestoreRequest = z.infer<typeof DocumentRestoreRequest>;

/** A printable file of a document (plan v3 step 29): PDF, Word, or Word in the Kruti Dev font. */
export const ExportFormat = contract("ExportFormat", z.enum(["pdf", "docx", "krutidev_docx"]));
export type ExportFormat = z.infer<typeof ExportFormat>;

/** For papers: the paper itself, its answer key, or the solutions. Notes have only themselves. */
export const ExportVariant = contract("ExportVariant", z.enum(["paper", "answer_key", "solutions"]));
export type ExportVariant = z.infer<typeof ExportVariant>;

export const ExportRequest = contract(
  "ExportRequest",
  z.object({
    format: ExportFormat,
    variant: ExportVariant.default("paper"),
    /** A booklet set's order and key; the paper's own order when null. */
    setCode: z
      .string()
      .regex(/^[A-Z]$/)
      .nullable()
      .default(null),
  }),
);
export type ExportRequest = z.infer<typeof ExportRequest>;

export const DocumentExport = contract(
  "DocumentExport",
  z.object({
    id: Uuid,
    /** The version it was made from. */
    version: z.number().int().positive(),
    format: ExportFormat,
    variant: ExportVariant,
    setCode: z.string().nullable(),
    status: z.enum(["pending", "done", "failed"]),
    error: z.string().nullable(),
    /** What the download is called ("Force test - Set B - answer key.pdf"). */
    filename: z.string(),
    createdAt: z.iso.datetime({ offset: true }),
  }),
);
export type DocumentExport = z.infer<typeof DocumentExport>;

/** A download's name: "Force test - Set B - Answer key.pdf", "Force notes - Kruti Dev.docx". */
export function exportFileName(
  title: string,
  variant: ExportVariant,
  setCode: string | null,
  format: ExportFormat,
): string {
  const parts = [
    title,
    ...(setCode ? [`Set ${setCode}`] : []),
    ...(variant === "answer_key" ? ["Answer key"] : variant === "solutions" ? ["Solutions"] : []),
    ...(format === "krutidev_docx" ? ["Kruti Dev"] : []),
  ];
  const safe = parts
    .join(" - ")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
  return `${safe || "document"}.${format === "pdf" ? "pdf" : "docx"}`;
}
