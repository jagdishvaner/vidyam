import { Controller, Get } from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import { Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { CurrentUser } from "@vidyam/contracts";

import { GetCurrentUser } from "../application/get-current-user.js";

@ApiTags("identity")
@Controller("me")
export class MeController {
  constructor(private readonly getCurrentUser: GetCurrentUser) {}

  @Get()
  @ApiResponse({ status: 200, standardSchema: CurrentUser })
  me(@Session() session: UserSession): Promise<CurrentUser> {
    const active = (session.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
    return this.getCurrentUser.execute({ user: session.user, activeOrganizationId: active });
  }
}
