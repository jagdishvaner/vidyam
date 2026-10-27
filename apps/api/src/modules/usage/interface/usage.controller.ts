import { Body, Controller, Get, HttpCode, Put, Query } from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  MemberHasPermission,
  RequireActiveOrg,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import { SetCenterBudgetRequest, UsageQuery, UsageReport } from "@vidyam/contracts";

import { Audit } from "../../../shared/audit/audit.js";
import { activeOrg } from "../../../shared/auth/session.js";
import { UsageReports } from "../application/usage-reports.js";

/** Admin → Usage & budgets: AI spend by teacher, job, model and day, and the center's monthly budget. */
@ApiTags("usage")
@Controller("usage")
@RequireActiveOrg()
@MemberHasPermission({ permissions: { budget: ["manage"] } })
export class UsageController {
  constructor(private readonly usage: UsageReports) {}

  @Get()
  @ApiResponse({ status: 200, standardSchema: UsageReport })
  report(
    @Session() session: UserSession,
    @Query({ schema: UsageQuery }) query: UsageQuery,
  ): Promise<UsageReport> {
    return this.usage.report(activeOrg(session), query.month);
  }

  @Put("budget")
  @Audit({ action: "budget.set", entityType: "center", entityId: () => "budget" })
  @HttpCode(204)
  async setBudget(
    @Session() session: UserSession,
    @Body({ schema: SetCenterBudgetRequest }) body: SetCenterBudgetRequest,
  ): Promise<void> {
    await this.usage.setCenterBudget(activeOrg(session), body);
  }
}
