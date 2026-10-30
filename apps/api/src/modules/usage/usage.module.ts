import { Module } from "@nestjs/common";

import { USAGE_STORE, UsageReports } from "./application/usage-reports.js";
import { DrizzleUsageStore } from "./infrastructure/drizzle-usage-store.js";
import { MyUsageController } from "./interface/my-usage.controller.js";
import { UsageController } from "./interface/usage.controller.js";

/** Composition root for Admin → Usage & budgets and each member's own meter (reads the AI engine's ledger). */
@Module({
  controllers: [UsageController, MyUsageController],
  providers: [UsageReports, { provide: USAGE_STORE, useClass: DrizzleUsageStore }],
})
export class UsageModule {}
