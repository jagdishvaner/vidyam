import { z } from "zod";

import { CitationRef } from "./chat.js";
import { Uuid } from "./common.js";
import { contract } from "./registry.js";
import { LocalizedText, NotesSpec } from "./tasks.js";

export const NotesSectionState = contract(
  "NotesSectionState",
  z.enum(["pending", "written", "verified", "flagged", "insufficient_evidence"]),
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
