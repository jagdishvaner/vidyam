import { Module } from "@nestjs/common";

import { COVERAGE_STORE, GetCoverage } from "./application/get-coverage.js";
import { GetDashboardSummary, ORG_COUNTS } from "./application/get-dashboard-summary.js";
import { DrizzleCoverageStore } from "./infrastructure/drizzle-coverage-store.js";
import { DrizzleOrgCounts } from "./infrastructure/drizzle-org-counts.js";
import { DashboardController } from "./interface/dashboard.controller.js";

@Module({
  controllers: [DashboardController],
  providers: [
    GetDashboardSummary,
    GetCoverage,
    { provide: ORG_COUNTS, useClass: DrizzleOrgCounts },
    { provide: COVERAGE_STORE, useClass: DrizzleCoverageStore },
  ],
})
export class DashboardModule {}
