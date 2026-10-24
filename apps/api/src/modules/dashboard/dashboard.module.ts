import { Module } from "@nestjs/common";

import { GetDashboardSummary, ORG_COUNTS } from "./application/get-dashboard-summary.js";
import { DrizzleOrgCounts } from "./infrastructure/drizzle-org-counts.js";
import { DashboardController } from "./interface/dashboard.controller.js";

@Module({
  controllers: [DashboardController],
  providers: [GetDashboardSummary, { provide: ORG_COUNTS, useClass: DrizzleOrgCounts }],
})
export class DashboardModule {}
