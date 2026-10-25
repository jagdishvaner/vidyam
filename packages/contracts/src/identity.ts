import { z } from "zod";

import { OrgRole, Uuid } from "./common.js";
import { contract } from "./registry.js";

/** The signed-in user, their active organization and their role in it (GET /api/me). */
export const CurrentUser = contract(
  "CurrentUser",
  z.object({
    id: Uuid,
    name: z.string(),
    email: z.email(),
    /** Platform role from the admin plugin: "superadmin" or null for everyone else. */
    platformRole: z.enum(["superadmin"]).nullable(),
    organization: z.object({ id: Uuid, name: z.string(), slug: z.string() }).nullable(),
    orgRole: OrgRole.nullable(),
  }),
);
export type CurrentUser = z.infer<typeof CurrentUser>;

/** Same bounds as the auth server (Better Auth `minPasswordLength` / default maximum). */
export const Password = z.string().min(10).max(128);

/**
 * A center admin creates a member's account directly and shares the login with them; there are no emailed
 * invitations or reset links (ADR 0011).
 */
export const AddMemberRequest = contract(
  "AddMemberRequest",
  z.object({
    name: z.string().trim().min(1).max(120),
    email: z.email(),
    role: OrgRole,
    password: Password,
  }),
);
export type AddMemberRequest = z.infer<typeof AddMemberRequest>;

export const AddedMember = contract("AddedMember", z.object({ userId: Uuid }));
export type AddedMember = z.infer<typeof AddedMember>;

/** A center admin sets a new password for a member; the member is signed out everywhere. */
export const SetMemberPasswordRequest = contract(
  "SetMemberPasswordRequest",
  z.object({ password: Password }),
);
export type SetMemberPasswordRequest = z.infer<typeof SetMemberPasswordRequest>;
