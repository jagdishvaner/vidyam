import { z } from "zod";

import { contract } from "./registry.js";

export const Uuid = z.uuid();

/** Content language of a single text. `mixed` describes a source that interleaves Hindi and English. */
export const Language = contract("Language", z.enum(["hi", "en"]));
export type Language = z.infer<typeof Language>;

export const SourceLanguage = contract("SourceLanguage", z.enum(["hi", "en", "mixed"]));
export type SourceLanguage = z.infer<typeof SourceLanguage>;

/** Who may reuse a source's content: the center's own material, a third-party book, or a past-year paper. */
export const Licence = contract("Licence", z.enum(["own", "third_party", "pyq"]));
export type Licence = z.infer<typeof Licence>;

/** What an uploaded file is. Must match SOURCE_KINDS in @vidyam/db. */
export const SourceKind = contract(
  "SourceKind",
  z.enum(["book", "notes", "question_paper", "answer_key", "booklet", "video", "image", "other"]),
);
export type SourceKind = z.infer<typeof SourceKind>;

/** Roles inside an organization (coaching center). Platform super-admin is a separate, system-level role. */
export const OrgRole = contract("OrgRole", z.enum(["admin", "reviewer", "teacher", "content_operator"]));
export type OrgRole = z.infer<typeof OrgRole>;

export const PLATFORM_ADMIN_ROLE = "superadmin";
