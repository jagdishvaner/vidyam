import { z } from "zod";

import { Uuid } from "./common.js";
import { contract } from "./registry.js";

/** Everything an admin can change is recorded under one of these actions. */
export const AuditAction = contract(
  "AuditAction",
  z.enum([
    "member.create",
    "member.password_reset",
    "member.remove",
    "staff.update",
    "library.remove",
    "syllabus.import",
    "syllabus.node_create",
    "syllabus.node_update",
    "exam.import",
    "exam.delete",
    "pattern.create",
    "pattern.update",
    "pattern.import",
    "pattern.retire",
    "center.branding",
    "center.ai_policy",
    "center.logo_set",
    "center.logo_remove",
    "ai.model_update",
    "ai.route_set",
    "ai.route_clear",
    "prompt.create",
    "prompt.activate",
    "budget.set",
  ]),
);
export type AuditAction = z.infer<typeof AuditAction>;

export const AuditEntry = contract(
  "AuditEntry",
  z.object({
    id: Uuid,
    at: z.iso.datetime({ offset: true }),
    actor: z.object({ id: Uuid, name: z.string(), email: z.string() }).nullable(),
    action: z.string(),
    entityType: z.string(),
    entityId: z.string(),
    /** What was sent (secrets removed) or, for imports, what changed. */
    data: z.record(z.string(), z.unknown()),
  }),
);
export type AuditEntry = z.infer<typeof AuditEntry>;

export const AuditQuery = contract(
  "AuditQuery",
  z.object({
    /** An action ("staff.update") or an area ("staff"). */
    action: z
      .string()
      .regex(/^[a-z_]+(\.[a-z_]+)?$/)
      .optional(),
    userId: Uuid.optional(),
    /** The `nextCursor` of the previous page. */
    cursor: z.string().optional(),
  }),
);
export type AuditQuery = z.infer<typeof AuditQuery>;

export const AuditPage = contract(
  "AuditPage",
  z.object({ entries: z.array(AuditEntry), nextCursor: z.string().nullable() }),
);
export type AuditPage = z.infer<typeof AuditPage>;
