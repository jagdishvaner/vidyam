import { z } from "zod";

import { Uuid } from "./common.js";
import { contract } from "./registry.js";
import { LocalizedText } from "./tasks.js";
import { Month } from "./usage.js";

/** Counts for the active organization's home screen. */
export const DashboardSummary = contract(
  "DashboardSummary",
  z.object({
    sources: z.number().int().nonnegative(),
    questions: z.number().int().nonnegative(),
    documents: z.number().int().nonnegative(),
  }),
);
export type DashboardSummary = z.infer<typeof DashboardSummary>;

/** A teacher's own AI use this month, against their budget (the dashboard's meter). */
export const MyUsage = contract(
  "MyUsage",
  z.object({
    month: Month,
    calls: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
    /** The teacher's own monthly limit; null when they have none. */
    budgetUsd: z.number().nonnegative().nullable(),
    /** The center's budget for the month is used up: nobody's calls go through until next month. */
    centerExhausted: z.boolean(),
  }),
);
export type MyUsage = z.infer<typeof MyUsage>;

/** How much of each subject the center's material covers (plan v3 §2, the admin dashboard). */
export const SubjectCoverage = contract(
  "SubjectCoverage",
  z.object({
    nodeId: Uuid,
    name: LocalizedText,
    chapters: z.number().int().nonnegative(),
    /** Chapters with at least one searchable passage. */
    chaptersWithMaterial: z.number().int().nonnegative(),
    passages: z.number().int().nonnegative(),
    /** Approved and checked questions in the bank. */
    questions: z.number().int().nonnegative(),
  }),
);
export type SubjectCoverage = z.infer<typeof SubjectCoverage>;

export const CoverageReport = contract("CoverageReport", z.object({ subjects: z.array(SubjectCoverage) }));
export type CoverageReport = z.infer<typeof CoverageReport>;
