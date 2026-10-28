import type { OrgRole } from "@vidyam/contracts";

/** In the order admins usually pick them. */
export const ROLES = [
  "teacher",
  "reviewer",
  "content_operator",
  "admin",
] as const satisfies readonly OrgRole[];
