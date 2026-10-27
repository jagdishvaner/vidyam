import type { UserSession } from "@thallesp/nestjs-better-auth";
import { PLATFORM_ADMIN_ROLE } from "@vidyam/contracts";

/** The center the signed-in user is working in (routes behind @RequireActiveOrg or @OrgRoles always have one). */
export function activeOrg(session: UserSession): string {
  return (session.session as { activeOrganizationId: string }).activeOrganizationId;
}

/** Better Auth stores platform roles as a comma-separated list. */
export function isPlatformAdmin(session: UserSession): boolean {
  return String((session.user as { role?: string | null }).role ?? "")
    .split(",")
    .includes(PLATFORM_ADMIN_ROLE);
}
