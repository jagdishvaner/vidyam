import { Controller, Get, Query } from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  MemberHasPermission,
  RequireActiveOrg,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import { AuditPage, AuditQuery } from "@vidyam/contracts";

import { activeOrg } from "../../../shared/auth/session.js";
import { ReadAuditLog } from "../application/read-audit-log.js";

/** Admin → Audit log: every change admins made in this center, newest first. */
@ApiTags("audit")
@Controller("audit")
@RequireActiveOrg()
@MemberHasPermission({ permissions: { audit: ["read"] } })
export class AuditController {
  constructor(private readonly read: ReadAuditLog) {}

  @Get()
  @ApiResponse({ status: 200, standardSchema: AuditPage })
  page(
    @Session() session: UserSession,
    @Query({ schema: AuditQuery }) query: AuditQuery,
  ): Promise<AuditPage> {
    return this.read.execute(activeOrg(session), query);
  }
}
