import { z } from "zod";

import { contract } from "./registry.js";

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
