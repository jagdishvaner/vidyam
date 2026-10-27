import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import { OrgRoles, Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { AddedMember, AddMemberRequest, SetMemberPasswordRequest } from "@vidyam/contracts";

import { activeOrg, isPlatformAdmin } from "../../../shared/auth/session.js";
import { AddMember, RemoveMember, SetMemberPassword } from "../application/manage-members.js";

/** Center admins manage logins for their own center. */
@ApiTags("identity")
@Controller("members")
@OrgRoles(["admin"])
export class MembersController {
  constructor(
    private readonly addMember: AddMember,
    private readonly setMemberPassword: SetMemberPassword,
    private readonly removeMember: RemoveMember,
  ) {}

  @Post()
  @ApiResponse({ status: 201, standardSchema: AddedMember })
  add(
    @Session() session: UserSession,
    @Body({ schema: AddMemberRequest }) body: AddMemberRequest,
  ): Promise<AddedMember> {
    return this.addMember.execute(activeOrg(session), body);
  }

  @Put(":userId/password")
  @HttpCode(204)
  async setPassword(
    @Session() session: UserSession,
    @Param("userId", new ParseUUIDPipe()) userId: string,
    @Body({ schema: SetMemberPasswordRequest }) body: SetMemberPasswordRequest,
  ): Promise<void> {
    await this.setMemberPassword.execute({
      organizationId: activeOrg(session),
      actorIsPlatformAdmin: isPlatformAdmin(session),
      userId,
      password: body.password,
    });
  }

  @Delete(":userId")
  @HttpCode(204)
  async remove(
    @Session() session: UserSession,
    @Param("userId", new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    await this.removeMember.execute({
      organizationId: activeOrg(session),
      actorIsPlatformAdmin: isPlatformAdmin(session),
      actorId: session.user.id,
      userId,
    });
  }
}
