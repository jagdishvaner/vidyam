import { Controller, Get } from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import { RequireActiveOrg, Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { DashboardSummary } from "@vidyam/contracts";

import { activeOrg } from "../../../shared/auth/session.js";
import { GetDashboardSummary } from "../application/get-dashboard-summary.js";

@ApiTags("dashboard")
@Controller("dashboard")
export class DashboardController {
  constructor(private readonly getSummary: GetDashboardSummary) {}

  @Get("summary")
  @RequireActiveOrg()
  @ApiResponse({ status: 200, standardSchema: DashboardSummary })
  summary(@Session() session: UserSession): Promise<DashboardSummary> {
    return this.getSummary.execute(activeOrg(session));
  }
}
