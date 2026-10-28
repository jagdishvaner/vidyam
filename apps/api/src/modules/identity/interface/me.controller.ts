import { Body, Controller, Get, HttpCode, Put } from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import { RequireActiveOrg, Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { CurrentUser, MemberSettings, MySettings, UpdateProfileRequest } from "@vidyam/contracts";

import { activeOrg } from "../../../shared/auth/session.js";
import { GetCurrentUser } from "../application/get-current-user.js";
import { MySettingsService } from "../application/my-settings.js";

@ApiTags("identity")
@Controller("me")
export class MeController {
  constructor(
    private readonly getCurrentUser: GetCurrentUser,
    private readonly mySettings: MySettingsService,
  ) {}

  @Get()
  @ApiResponse({ status: 200, standardSchema: CurrentUser })
  me(@Session() session: UserSession): Promise<CurrentUser> {
    const active = (session.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
    return this.getCurrentUser.execute({ user: session.user, activeOrganizationId: active });
  }

  /** Settings page: the person's own defaults in the active center, and the choices it allows. */
  @Get("settings")
  @RequireActiveOrg()
  @ApiResponse({ status: 200, standardSchema: MySettings })
  settings(@Session() session: UserSession): Promise<MySettings> {
    return this.mySettings.get(activeOrg(session), session.user.id);
  }

  @Put("settings")
  @HttpCode(204)
  @RequireActiveOrg()
  async updateSettings(
    @Session() session: UserSession,
    @Body({ schema: MemberSettings }) body: MemberSettings,
  ): Promise<void> {
    await this.mySettings.update(activeOrg(session), session.user.id, body);
  }

  /** Everyone can change their own display name; the login email is changed by an admin. */
  @Put("profile")
  @HttpCode(204)
  async updateProfile(
    @Session() session: UserSession,
    @Body({ schema: UpdateProfileRequest }) body: UpdateProfileRequest,
  ): Promise<void> {
    await this.mySettings.rename(session.user.id, body.name);
  }
}
