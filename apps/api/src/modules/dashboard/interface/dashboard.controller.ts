import { Controller, Get } from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  MemberHasPermission,
  RequireActiveOrg,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import { CoverageReport, DashboardSummary } from "@vidyam/contracts";

import { activeOrg } from "../../../shared/auth/session.js";
import { GetCoverage } from "../application/get-coverage.js";
import { GetDashboardSummary } from "../application/get-dashboard-summary.js";

@ApiTags("dashboard")
@Controller("dashboard")
export class DashboardController {
  constructor(
    private readonly getSummary: GetDashboardSummary,
    private readonly getCoverage: GetCoverage,
  ) {}

  @Get("summary")
  @RequireActiveOrg()
  @ApiResponse({ status: 200, standardSchema: DashboardSummary })
  summary(@Session() session: UserSession): Promise<DashboardSummary> {
    return this.getSummary.execute(activeOrg(session));
  }

  /** Which subjects and chapters the material covers: for those who look after the library. */
  @Get("coverage")
  @RequireActiveOrg()
  @MemberHasPermission({ permissions: { library: ["process"] } })
  @ApiResponse({ status: 200, standardSchema: CoverageReport })
  coverage(@Session() session: UserSession): Promise<CoverageReport> {
    return this.getCoverage.execute(activeOrg(session));
  }
}
