import { Inject, Injectable } from "@nestjs/common";
import type { MyUsage, SetCenterBudgetRequest, UsageReport } from "@vidyam/contracts";

import { currentMonth, monthRange } from "../../../shared/kernel/month.js";

/** Port: the usage ledger (llm_calls) and the center's own budget (quotas row without a user). */
export interface UsageStore {
  report(orgId: string, month: string, range: { start: Date; end: Date }): Promise<UsageReport>;
  setCenterBudget(orgId: string, budget: SetCenterBudgetRequest): Promise<void>;
  /** One teacher's calls and spend in the month, their limit, and whether the center's is used up. */
  mine(orgId: string, userId: string, month: string, range: { start: Date; end: Date }): Promise<MyUsage>;
}
export const USAGE_STORE = Symbol("USAGE_STORE");

@Injectable()
export class UsageReports {
  constructor(@Inject(USAGE_STORE) private readonly store: UsageStore) {}

  report(orgId: string, month = currentMonth(new Date())): Promise<UsageReport> {
    return this.store.report(orgId, month, monthRange(month));
  }

  setCenterBudget(orgId: string, budget: SetCenterBudgetRequest): Promise<void> {
    return this.store.setCenterBudget(orgId, budget);
  }

  /** A teacher's own use this month (the dashboard): only their spend, never their colleagues'. */
  mine(orgId: string, userId: string): Promise<MyUsage> {
    const month = currentMonth(new Date());
    return this.store.mine(orgId, userId, month, monthRange(month));
  }
}
