import { Controller, Get } from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import { Liveness, SystemStatus } from "@vidyam/contracts";

import { CheckSystemStatus } from "../application/check-system-status.js";

@ApiTags("system")
@Controller()
export class SystemController {
  constructor(private readonly checkStatus: CheckSystemStatus) {}

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
}
