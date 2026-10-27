import { z } from "zod";

import { Uuid } from "./common.js";
import { contract } from "./registry.js";

/** A calendar month in India time, e.g. "2026-10". */
export const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const UsageQuery = contract("UsageQuery", z.object({ month: Month.optional() }));
export type UsageQuery = z.infer<typeof UsageQuery>;

const Spend = z.object({ calls: z.number().int().nonnegative(), costUsd: z.number().nonnegative() });

/** Admin → Usage & budgets: what the center's AI use cost in a month, from the usage ledger (llm_calls). */
export const UsageReport = contract(
  "UsageReport",
  z.object({
    month: Month,
    totals: Spend.extend({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      cacheReadTokens: z.number().int().nonnegative(),
      batchCalls: z.number().int().nonnegative(),
    }),
    budget: z.object({
      /** Null: no center limit. */
      monthlyLimitUsd: z.number().nullable(),
      /** Warn when spend passes this share of the limit. */
      softLimitPct: z.number().int(),
    }),
    byTeacher: z.array(
      Spend.extend({
        /** Null for work no one started directly (e.g. the nightly question top-up). */
        userId: Uuid.nullable(),
        name: z.string().nullable(),
        monthlyBudgetUsd: z.number().nullable(),
      }),
    ),
    byTask: z.array(Spend.extend({ task: z.string() })),
    byModel: z.array(Spend.extend({ modelId: z.string() })),
    byDay: z.array(Spend.extend({ date: z.iso.date() })),
  }),
);
export type UsageReport = z.infer<typeof UsageReport>;

export const SetCenterBudgetRequest = contract(
  "SetCenterBudgetRequest",
  z.object({
    monthlyLimitUsd: z.number().min(0).max(1_000_000).nullable(),
    softLimitPct: z.number().int().min(1).max(100),
  }),
);
export type SetCenterBudgetRequest = z.infer<typeof SetCenterBudgetRequest>;
