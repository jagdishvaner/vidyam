import { z } from "zod";

import { contract } from "./registry.js";

export const DependencyStatus = contract(
  "DependencyStatus",
  z.object({
    name: z.string(),
    ok: z.boolean(),
    latencyMs: z.number().int().nonnegative(),
    detail: z.string().nullable(),
  }),
);
export type DependencyStatus = z.infer<typeof DependencyStatus>;

export const ServiceHealth = contract(
  "ServiceHealth",
  z.object({
    service: z.enum(["api", "ai", "render"]),
    version: z.string(),
    ok: z.boolean(),
    dependencies: z.array(DependencyStatus),
  }),
  "Health of one service and each dependency it checked.",
);
export type ServiceHealth = z.infer<typeof ServiceHealth>;

export const SystemStatus = contract(
  "SystemStatus",
  z.object({ ok: z.boolean(), services: z.array(ServiceHealth) }),
  "Health of every service (API and AI engine), shown on the admin dashboard.",
);
export type SystemStatus = z.infer<typeof SystemStatus>;

export const Liveness = contract("Liveness", z.object({ ok: z.boolean() }));
export type Liveness = z.infer<typeof Liveness>;

export const PROBLEM_KINDS = ["generation", "export", "chat", "ai_call", "source"] as const;

/**
 * Something that went wrong recently (plan v3 step 31): a paper or notes that failed to be made, an export,
 * a chat answer, calls to an AI provider, or a file that failed to be read in. Calls failing the same way are
 * one problem with a count.
 */
export const Problem = contract(
  "Problem",
  z.object({
    kind: z.enum(PROBLEM_KINDS),
    /** The failed row's id; for AI calls, the latest of them. */
    id: z.string(),
    at: z.iso.datetime({ offset: true }),
    /** What failed, e.g. the document's title, the file's name, or the task and model. */
    subject: z.string(),
    /** Whose work it was, when someone's. */
    person: z.string().nullable(),
    error: z.string(),
    count: z.number().int().positive(),
  }),
);
export type Problem = z.infer<typeof Problem>;

export const ProblemReport = contract(
  "ProblemReport",
  z.object({
    since: z.iso.datetime({ offset: true }),
    /** Newest first, at most 50. */
    items: z.array(Problem),
  }),
  "What went wrong in the last day, for Admin → System health.",
);
export type ProblemReport = z.infer<typeof ProblemReport>;
