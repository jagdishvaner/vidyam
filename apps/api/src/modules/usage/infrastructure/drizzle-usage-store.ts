import { Injectable } from "@nestjs/common";
import type { MyUsage, SetCenterBudgetRequest, UsageReport } from "@vidyam/contracts";
import { schema } from "@vidyam/db";
import { and, count, desc, eq, gte, isNotNull, isNull, lt, sql, sum } from "drizzle-orm";

import { OrgDatabase } from "../../../shared/database/org-database.js";
import type { UsageStore } from "../application/usage-reports.js";

const { llmCalls, quotas, users } = schema;
const spend = { calls: count(), cost: sum(llmCalls.costUsd) };
const money = (value: string | null) => Math.round(Number(value ?? 0) * 1_000_000) / 1_000_000;

/** Every query is scoped to the center by row-level security and to the month by the ledger's timestamps. */
@Injectable()
export class DrizzleUsageStore implements UsageStore {
  constructor(private readonly orgDb: OrgDatabase) {}

  report(orgId: string, month: string, range: { start: Date; end: Date }): Promise<UsageReport> {
    return this.orgDb.run(orgId, async (tx) => {
      const inMonth = and(gte(llmCalls.createdAt, range.start), lt(llmCalls.createdAt, range.end));
      const [totals] = await tx
        .select({
          ...spend,
          input: sum(llmCalls.inputTokens),
          output: sum(llmCalls.outputTokens),
          cacheRead: sum(llmCalls.cacheReadTokens),
          batch: sql<number>`count(*) filter (where ${llmCalls.isBatch})::int`,
        })
        .from(llmCalls)
        .where(inMonth);
      const [center] = await tx.select().from(quotas).where(isNull(quotas.userId));
      const personal = await tx
        .select({ userId: quotas.userId, limit: quotas.monthlyLimitUsd })
        .from(quotas)
        .where(isNotNull(quotas.userId));
      const byTeacher = await tx
        .select({ userId: llmCalls.userId, name: users.name, ...spend })
        .from(llmCalls)
        .leftJoin(users, eq(users.id, llmCalls.userId))
        .where(inMonth)
        .groupBy(llmCalls.userId, users.name)
        .orderBy(desc(sum(llmCalls.costUsd)));
      const byTask = await tx
        .select({ task: llmCalls.task, ...spend })
        .from(llmCalls)
        .where(inMonth)
        .groupBy(llmCalls.task)
        .orderBy(desc(sum(llmCalls.costUsd)));
      const byModel = await tx
        .select({ modelId: llmCalls.modelId, ...spend })
        .from(llmCalls)
        .where(inMonth)
        .groupBy(llmCalls.modelId)
        .orderBy(desc(sum(llmCalls.costUsd)));
      const day = sql<string>`to_char(${llmCalls.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`;
      const byDay = await tx
        .select({ date: day, ...spend })
        .from(llmCalls)
        .where(inMonth)
        .groupBy(day)
        .orderBy(day);

      const budgetOf = new Map(personal.map((p) => [p.userId, Number(p.limit)]));
      return {
        month,
        totals: {
          calls: totals?.calls ?? 0,
          costUsd: money(totals?.cost ?? null),
          inputTokens: Number(totals?.input ?? 0),
          outputTokens: Number(totals?.output ?? 0),
          cacheReadTokens: Number(totals?.cacheRead ?? 0),
          batchCalls: totals?.batch ?? 0,
        },
        budget: {
          monthlyLimitUsd: center ? Number(center.monthlyLimitUsd) : null,
          softLimitPct: center?.softLimitPct ?? 80,
        },
        byTeacher: byTeacher.map((r) => ({
          userId: r.userId,
          name: r.name,
          calls: r.calls,
          costUsd: money(r.cost),
          monthlyBudgetUsd: r.userId ? (budgetOf.get(r.userId) ?? null) : null,
        })),
        byTask: byTask.map((r) => ({ task: r.task, calls: r.calls, costUsd: money(r.cost) })),
        byModel: byModel.map((r) => ({ modelId: r.modelId, calls: r.calls, costUsd: money(r.cost) })),
        byDay: byDay.map((r) => ({ date: r.date, calls: r.calls, costUsd: money(r.cost) })),
      };
    });
  }

  setCenterBudget(orgId: string, budget: SetCenterBudgetRequest): Promise<void> {
    return this.orgDb.run(orgId, async (tx) => {
      if (budget.monthlyLimitUsd === null) {
        await tx.delete(quotas).where(isNull(quotas.userId));
        return;
      }
      const values = {
        monthlyLimitUsd: budget.monthlyLimitUsd.toFixed(2),
        softLimitPct: budget.softLimitPct,
      };
      await tx
        .insert(quotas)
        .values({ orgId, userId: null, ...values })
        .onConflictDoUpdate({
          target: [quotas.orgId, quotas.userId],
          set: { ...values, updatedAt: new Date() },
        });
    });
  }

  mine(orgId: string, userId: string, month: string, range: { start: Date; end: Date }): Promise<MyUsage> {
    return this.orgDb.run(orgId, async (tx) => {
      const inMonth = and(gte(llmCalls.createdAt, range.start), lt(llmCalls.createdAt, range.end));
      const [own] = await tx
        .select(spend)
        .from(llmCalls)
        .where(and(inMonth, eq(llmCalls.userId, userId)));
      const [limit] = await tx.select().from(quotas).where(eq(quotas.userId, userId));
      const [center] = await tx.select().from(quotas).where(isNull(quotas.userId));
      let centerExhausted = false;
      if (center) {
        const [all] = await tx.select(spend).from(llmCalls).where(inMonth);
        centerExhausted = money(all?.cost ?? null) >= Number(center.monthlyLimitUsd);
      }
      return {
        month,
        calls: own?.calls ?? 0,
        costUsd: money(own?.cost ?? null),
        budgetUsd: limit ? Number(limit.monthlyLimitUsd) : null,
        centerExhausted,
      };
    });
  }
}
