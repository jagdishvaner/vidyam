import { Controller, Get } from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  AllowAnonymous,
  MemberHasPermission,
  RequireActiveOrg,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import { Liveness, ProblemReport, SystemStatus } from "@vidyam/contracts";

import { activeOrg } from "../../../shared/auth/session.js";

import { CheckSystemStatus } from "../application/check-system-status.js";
import { ListProblems } from "../application/list-problems.js";

@ApiTags("system")
@Controller()
export class SystemController {
  constructor(
    private readonly checkStatus: CheckSystemStatus,
    private readonly listProblems: ListProblems,
  ) {}

  /** Liveness for load balancers and Caddy; reveals nothing about dependencies. */
  @Get("health")
  @AllowAnonymous()
  @ApiResponse({ status: 200, standardSchema: Liveness })
  health(): Liveness {
    return { ok: true };
  }

  /** Every service and dependency, for the dashboard. Signed-in users only. */
  @Get("system/status")
  @ApiResponse({ status: 200, standardSchema: SystemStatus })
  status(): Promise<SystemStatus> {
    return this.checkStatus.execute();
  }

  /** What failed in the last day: for admins, on System health. */
  @Get("system/problems")
  @RequireActiveOrg()
  @MemberHasPermission({ permissions: { audit: ["read"] } })
  @ApiResponse({ status: 200, standardSchema: ProblemReport })
  problems(@Session() session: UserSession): Promise<ProblemReport> {
    return this.listProblems.execute(activeOrg(session));
  }
}
