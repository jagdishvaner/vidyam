import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  MemberHasPermission,
  RequireActiveOrg,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import { CreatePromptVersionRequest, PromptsOverview, PromptVersion } from "@vidyam/contracts";

import { isPlatformAdmin } from "../../../shared/auth/session.js";
import { PromptAdmin } from "../application/manage-prompts.js";

/** Admin → Prompts. Center admins read them; the platform admin writes and activates versions. */
@ApiTags("ai")
@Controller("prompts")
@RequireActiveOrg()
@MemberHasPermission({ permissions: { ai: ["manage"] } })
export class PromptsController {
  constructor(private readonly prompts: PromptAdmin) {}

  @Get()
  @ApiResponse({ status: 200, standardSchema: PromptsOverview })
  list(@Session() session: UserSession): Promise<PromptsOverview> {
    return this.prompts.overview(isPlatformAdmin(session));
  }

  @Post()
  @ApiResponse({ status: 201, standardSchema: PromptVersion })
  create(
    @Session() session: UserSession,
    @Body({ schema: CreatePromptVersionRequest }) body: CreatePromptVersionRequest,
  ): Promise<PromptVersion> {
    return this.prompts.create(body, session.user.id, isPlatformAdmin(session));
  }

  @Post(":promptId/activate")
  @HttpCode(204)
  async activate(
    @Session() session: UserSession,
    @Param("promptId", new ParseUUIDPipe()) promptId: string,
  ): Promise<void> {
    await this.prompts.activate(promptId, isPlatformAdmin(session));
  }
}
