import { Module } from "@nestjs/common";

import { USAGE_STORE, UsageReports } from "./application/usage-reports.js";
import { DrizzleUsageStore } from "./infrastructure/drizzle-usage-store.js";
import { UsageController } from "./interface/usage.controller.js";

/** Composition root for Admin → Usage & budgets (reads the ledger the AI engine writes). */
@Module({
  controllers: [UsageController],
  providers: [UsageReports, { provide: USAGE_STORE, useClass: DrizzleUsageStore }],
})
export class UsageModule {}
