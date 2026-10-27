import { Body, Controller, Delete, Get, HttpCode, Param, Put } from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  MemberHasPermission,
  RequireActiveOrg,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import { AiOverview, LlmTask, SetTaskRouteRequest, UpdateAiModelRequest } from "@vidyam/contracts";

import { activeOrg, isPlatformAdmin } from "../../../shared/auth/session.js";
import { AiSettings } from "../application/manage-ai.js";

const MANAGE = { permissions: { ai: ["manage"] } };

/** Admin → AI models: the model registry, task routes and whether provider keys are set. */
@ApiTags("ai")
@Controller("ai")
@RequireActiveOrg()
@MemberHasPermission(MANAGE)
export class AiController {
  constructor(private readonly ai: AiSettings) {}

  @Get()
  @ApiResponse({ status: 200, standardSchema: AiOverview })
  overview(@Session() session: UserSession): Promise<AiOverview> {
    return this.ai.overview(activeOrg(session), isPlatformAdmin(session));
  }

  @Put("models/:modelId")
  @HttpCode(204)
  async updateModel(
    @Session() session: UserSession,
    @Param("modelId") modelId: string,
    @Body({ schema: UpdateAiModelRequest }) body: UpdateAiModelRequest,
  ): Promise<void> {
    await this.ai.updateModel(modelId, body, isPlatformAdmin(session));
  }

  @Put("routes/:task")
  @HttpCode(204)
  async setRoute(
    @Session() session: UserSession,
    @Param("task") task: string,
    @Body({ schema: SetTaskRouteRequest }) body: SetTaskRouteRequest,
  ): Promise<void> {
    await this.ai.setRoute(activeOrg(session), LlmTask.parse(task), body);
  }

  @Delete("routes/:task")
  @HttpCode(204)
  async clearRoute(@Session() session: UserSession, @Param("task") task: string): Promise<void> {
    await this.ai.clearRoute(activeOrg(session), LlmTask.parse(task));
  }
}
