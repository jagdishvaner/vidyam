import type { OrgRole } from "@vidyam/contracts";

/** In the order admins usually pick them. */
export const ROLES = [
  "teacher",
  "reviewer",
  "content_operator",
  "admin",
] as const satisfies readonly OrgRole[];

/** NestJS error bodies carry a readable `message`; validation errors may carry a list. */
export function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { message?: unknown } | undefined)?.message;
  return typeof message === "string" ? message : fallback;
}
