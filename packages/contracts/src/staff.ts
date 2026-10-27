import { z } from "zod";

import { OrgRole, Uuid } from "./common.js";
import { contract } from "./registry.js";

/** A syllabus subject a staff member can be assigned to. */
export const SubjectRef = contract(
  "SubjectRef",
  z.object({ nodeId: Uuid, code: z.string(), nameEn: z.string(), nameHi: z.string().nullable() }),
);
export type SubjectRef = z.infer<typeof SubjectRef>;

export const StaffSubject = contract(
  "StaffSubject",
  SubjectRef.extend({
    /** Head of department for this subject: reviews its questions and sees its usage. */
    isHead: z.boolean(),
  }),
);
export type StaffSubject = z.infer<typeof StaffSubject>;

/** One person on the Admin → Staff page. */
export const StaffMember = contract(
  "StaffMember",
  z.object({
    userId: Uuid,
    name: z.string(),
    email: z.email(),
    role: OrgRole,
    /** The platform super-admin's login; only another platform admin may change it. */
    platformAdmin: z.boolean(),
    subjects: z.array(StaffSubject),
    /** Personal monthly AI budget; null means only the center's budget applies. */
    monthlyBudgetUsd: z.number().nullable(),
    spentThisMonthUsd: z.number(),
    joinedAt: z.iso.datetime({ offset: true }),
  }),
);
export type StaffMember = z.infer<typeof StaffMember>;

export const StaffDirectory = contract(
  "StaffDirectory",
  z.object({
    members: z.array(StaffMember),
    /** Every subject in the center's syllabus, for assigning. */
    subjects: z.array(SubjectRef),
  }),
);
export type StaffDirectory = z.infer<typeof StaffDirectory>;

/** What an admin can change about a staff member (the login itself is managed through /members). */
export const UpdateStaffMemberRequest = contract(
  "UpdateStaffMemberRequest",
  z.object({
    role: OrgRole,
    subjects: z
      .array(z.object({ nodeId: Uuid, isHead: z.boolean() }))
      .max(30)
      .refine((s) => new Set(s.map((x) => x.nodeId)).size === s.length, "each subject once"),
    monthlyBudgetUsd: z.number().min(0).max(100_000).nullable(),
  }),
);
export type UpdateStaffMemberRequest = z.infer<typeof UpdateStaffMemberRequest>;
