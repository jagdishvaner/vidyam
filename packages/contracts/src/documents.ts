import { z } from "zod";

import { CitationRef, GenerationProgress } from "./chat.js";
import { Uuid } from "./common.js";
import { EditOp, PaperDocument } from "./paper.js";
import { Answer, QuestionContent, QuestionOrigin, QuestionStatus, QuestionType } from "./question.js";
import { contract } from "./registry.js";
import { LocalizedText, NotesSpec, TaskKind } from "./tasks.js";

export const NotesSectionState = contract(
  "NotesSectionState",
  z.enum(["pending", "written", "verified", "flagged", "insufficient_evidence", "edited"]),
);
export type NotesSectionState = z.infer<typeof NotesSectionState>;

/** One chapter or topic of notes, written from the center's material with its sources. */
export const NotesSection = contract(
  "NotesSection",
  z.object({
    nodeId: Uuid,
    title: LocalizedText,
    /** Markdown in each language the notes are made in; mathematics in LaTeX between $…$. */
    body: LocalizedText,
    citations: z.array(CitationRef).default([]),
    state: NotesSectionState,
    /** Why a check failed or evidence was missing. */
    flags: z.array(z.string()).default([]),
  }),
);
export type NotesSection = z.infer<typeof NotesSection>;

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
