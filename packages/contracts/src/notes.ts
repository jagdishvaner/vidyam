import { z } from "zod";

import { Uuid } from "./common.js";
import { contract } from "./registry.js";
import { CitationRef } from "./sources.js";
import { LocalizedText } from "./tasks.js";

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
