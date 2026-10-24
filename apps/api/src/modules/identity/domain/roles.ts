/** System-level role (Better Auth admin plugin). Everyone else has no platform role. */
export const PLATFORM_ADMIN = "superadmin";

/** Roles inside one organization (coaching center). Must match OrgRole in @vidyam/contracts. */
export const ORG_ROLES = ["admin", "reviewer", "teacher", "content_operator"] as const;
export type OrgRoleName = (typeof ORG_ROLES)[number];

export function asOrgRole(value: string | null | undefined): OrgRoleName | null {
  return ORG_ROLES.find((r) => r === value) ?? null;
}
