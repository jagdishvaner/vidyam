import { z } from "zod";

import { Uuid, type OrgRole } from "./common.js";
import { contract } from "./registry.js";
import { LocalizedText, Sourcing } from "./tasks.js";

/**
 * Everything a role can be allowed to do, by resource. The API builds Better Auth's access control from this,
 * and the Admin panel shows it as a read-only matrix (fixed roles, plan v3 §2).
 */
export const PERMISSIONS = {
  chat: ["use"],
  document: ["create", "edit", "export"],
  question: ["approve"],
  library: ["upload", "review", "remove"],
  syllabus: ["manage"],
  ai: ["manage"],
  budget: ["manage"],
  audit: ["read"],
  settings: ["manage"],
} as const;
export type PermissionResource = keyof typeof PERMISSIONS;
export type Permissions = { [R in PermissionResource]?: readonly (typeof PERMISSIONS)[R][number][] };

const teacher = {
  chat: ["use"],
  document: ["create", "edit", "export"],
} as const satisfies Permissions;

export const ROLE_PERMISSIONS: Record<OrgRole, Permissions> = {
  admin: PERMISSIONS,
  // Head of department: a teacher who also approves questions into the bank and reviews OCR output.
  reviewer: { ...teacher, question: ["approve"], library: ["review"] },
  teacher,
  // Looks after the library: uploads, corrects OCR output, removes wrong files. Can ask doubts in the chat.
  content_operator: { chat: ["use"], library: ["upload", "review", "remove"] },
};

/** How exported papers look: the center's name, logo and standing lines (org_settings.branding). */
export const OrgBranding = contract(
  "OrgBranding",
  z.object({
    name: LocalizedText,
    /** S3 key of the logo in the derived bucket. */
    logoKey: z.string().nullable().default(null),
    headerLines: LocalizedText.nullable().default(null),
    footer: LocalizedText.nullable().default(null),
    defaultInstructions: LocalizedText.nullable().default(null),
  }),
);
export type OrgBranding = z.infer<typeof OrgBranding>;

/** The center's AI rules (org_settings.ai_policy). */
export const AiPolicy = contract(
  "AiPolicy",
  z.object({
    /** Models teachers may pick in the chat; empty means every model the platform marks teacher-selectable. */
    allowedModelIds: z.array(z.string()).default([]),
    /** Answers must be re-solved by the other provider before an item counts as verified. */
    requireCrossProviderCheck: z.boolean().default(true),
    defaultSourcing: Sourcing.default("bank_first"),
  }),
);
export type AiPolicy = z.infer<typeof AiPolicy>;

export const ContentLanguage = contract("ContentLanguage", z.enum(["hi", "en", "bilingual"]));
export type ContentLanguage = z.infer<typeof ContentLanguage>;

/** A staff member's own defaults (Settings page). */
export const MemberSettings = contract(
  "MemberSettings",
  z.object({
    uiLocale: z.enum(["en", "hi"]),
    contentLanguage: ContentLanguage,
    defaultModelId: z.string().nullable(),
    defaultExamId: Uuid.nullable(),
  }),
);
export type MemberSettings = z.infer<typeof MemberSettings>;
