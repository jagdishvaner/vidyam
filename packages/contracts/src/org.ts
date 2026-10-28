import { z } from "zod";

import { Uuid, type OrgRole } from "./common.js";
import { contract } from "./registry.js";
import { StaffSubject } from "./staff.js";
import { LocalizedText, Sourcing } from "./tasks.js";

/**
 * Everything a role can be allowed to do, by resource. The API builds Better Auth's access control from this,
 * and the Admin panel shows it as a read-only matrix (fixed roles, plan v3 §2).
 */
export const PERMISSIONS = {
  chat: ["use"],
  document: ["create", "edit", "export"],
  question: ["approve"],
  /** process: run the paid backlogs (OCR, splitting papers into questions, topics), after their estimate. */
  library: ["upload", "review", "remove", "process"],
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
  // Looks after the library: uploads, runs and corrects OCR, removes wrong files. Can ask doubts in the chat.
  content_operator: { chat: ["use"], library: ["upload", "review", "remove", "process"] },
};

/** Whether a center role may do something. The API enforces this; the web app uses it to hide what would be refused. */
export function roleCan<R extends PermissionResource>(
  role: OrgRole | null,
  resource: R,
  action: (typeof PERMISSIONS)[R][number],
): boolean {
  if (!role) return false;
  const allowed: readonly string[] | undefined = ROLE_PERMISSIONS[role][resource];
  return allowed?.includes(action) ?? false;
}

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

/** A model teachers may be allowed to pick in the chat (from the platform's model registry). */
export const SelectableModel = contract(
  "SelectableModel",
  z.object({ id: z.string(), displayName: z.string(), provider: z.enum(["anthropic", "openai", "stub"]) }),
);
export type SelectableModel = z.infer<typeof SelectableModel>;

/** Admin → Center profile: how exports look and the center's AI rules. */
export const CenterProfile = contract(
  "CenterProfile",
  z.object({
    organization: z.object({ id: Uuid, name: z.string(), slug: z.string() }),
    branding: OrgBranding,
    /** Where the logo is served from, with a version so browsers refetch after a change; null if none. */
    logoUrl: z.string().nullable(),
    aiPolicy: AiPolicy,
    selectableModels: z.array(SelectableModel),
  }),
);
export type CenterProfile = z.infer<typeof CenterProfile>;

/** Everything about branding except the logo, which is uploaded on its own. */
export const UpdateBrandingRequest = contract("UpdateBrandingRequest", OrgBranding.omit({ logoKey: true }));
export type UpdateBrandingRequest = z.infer<typeof UpdateBrandingRequest>;

export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const LOGO_MAX_BYTES = 1_000_000;

/** The Settings page: the person's own defaults and what they can choose from. */
export const MySettings = contract(
  "MySettings",
  z.object({
    settings: MemberSettings,
    /** Models this center lets teachers pick (its AI rules), from the platform's teacher-selectable list. */
    models: z.array(SelectableModel),
    exams: z.array(
      z.object({ id: Uuid, code: z.string(), nameEn: z.string(), nameHi: z.string().nullable() }),
    ),
    /** Assigned by an admin under Staff. */
    subjects: z.array(StaffSubject),
  }),
);
export type MySettings = z.infer<typeof MySettings>;

export const UpdateProfileRequest = contract(
  "UpdateProfileRequest",
  z.object({ name: z.string().trim().min(1).max(120) }),
);
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequest>;
