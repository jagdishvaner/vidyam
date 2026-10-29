import { Injectable } from "@nestjs/common";
import { schema } from "@vidyam/db";
import { and, eq, gte, isNull, lt, or, sql } from "drizzle-orm";

import { OrgDatabase } from "../../../shared/database/org-database.js";
import { currentMonth, monthRange } from "../../../shared/kernel/month.js";
import type { BudgetGate } from "../application/ports.js";

const { llmCalls, quotas } = schema;

/**
 * The monthly budgets the AI engine also checks on every call (ADR 0008), checked before a turn is recorded so
 * a teacher over budget is told at once instead of after their message is saved.
 */
@Injectable()
export class DrizzleBudgetGate implements BudgetGate {
  constructor(private readonly orgDb: OrgDatabase) {}

  exhausted(orgId: string, userId: string, now: Date): Promise<string | null> {
    return this.orgDb.run(orgId, async (tx) => {
      const limits = await tx
        .select({ userId: quotas.userId, limit: quotas.monthlyLimitUsd })
        .from(quotas)
        .where(or(isNull(quotas.userId), eq(quotas.userId, userId)));
      if (!limits.length) return null;
      const { start, end } = monthRange(currentMonth(now));
      const [spent] = await tx
        .select({
          center: sql<string | null>`sum(${llmCalls.costUsd})`,
          mine: sql<string | null>`sum(${llmCalls.costUsd}) filter (where ${llmCalls.userId} = ${userId})`,
        })
        .from(llmCalls)
        .where(and(gte(llmCalls.createdAt, start), lt(llmCalls.createdAt, end)));
      for (const { userId: who, limit } of limits) {
        const used = Number((who ? spent?.mine : spent?.center) ?? 0);
        if (used >= Number(limit)) {
          const whose = who ? "Your" : "The center's";
          return `${whose} monthly AI budget of US$${Number(limit).toFixed(2)} is used up.`;
        }
      }
      return null;
    });
  }
}
