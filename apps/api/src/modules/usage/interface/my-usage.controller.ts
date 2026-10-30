import { Controller, Get } from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import { RequireActiveOrg, Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { MyUsage } from "@vidyam/contracts";

import { activeOrg } from "../../../shared/auth/session.js";
import { UsageReports } from "../application/usage-reports.js";

/** A member's own AI use this month (the dashboard's meter); every member may see their own. */
@ApiTags("usage")
@Controller("me/usage")
@RequireActiveOrg()
export class MyUsageController {
  constructor(private readonly usage: UsageReports) {}

  @Get()
  @ApiResponse({ status: 200, standardSchema: MyUsage })
  mine(@Session() session: UserSession): Promise<MyUsage> {
    return this.usage.mine(activeOrg(session), session.user.id);
  }
}
