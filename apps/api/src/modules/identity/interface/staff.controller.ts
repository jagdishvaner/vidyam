import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Put } from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import { OrgRoles, Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { StaffDirectory, UpdateStaffMemberRequest } from "@vidyam/contracts";

import { activeOrg, isPlatformAdmin } from "../../../shared/auth/session.js";
import { ListStaff, UpdateStaffMember } from "../application/manage-staff.js";

/** Admin → Staff: who does what, which subjects they teach, and their AI budget. Logins are under /members. */
@ApiTags("identity")
@Controller("staff")
@OrgRoles(["admin"])
export class StaffController {
  constructor(
    private readonly listStaff: ListStaff,
    private readonly updateStaff: UpdateStaffMember,
  ) {}

  @Get()
  @ApiResponse({ status: 200, standardSchema: StaffDirectory })
  list(@Session() session: UserSession): Promise<StaffDirectory> {
    return this.listStaff.execute(activeOrg(session));
  }

  @Put(":userId")
  @HttpCode(204)
  async update(
    @Session() session: UserSession,
    @Param("userId", new ParseUUIDPipe()) userId: string,
    @Body({ schema: UpdateStaffMemberRequest }) body: UpdateStaffMemberRequest,
  ): Promise<void> {
    await this.updateStaff.execute({
      organizationId: activeOrg(session),
      actorId: session.user.id,
      actorIsPlatformAdmin: isPlatformAdmin(session),
      userId,
      change: body,
    });
  }
}
