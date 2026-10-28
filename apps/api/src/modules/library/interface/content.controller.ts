import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  MemberHasPermission,
  RequireActiveOrg,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import { BacklogKind, BacklogOverview, BacklogRun, RunBacklogRequest } from "@vidyam/contracts";

import { Audit } from "../../../shared/audit/audit.js";
import { activeOrg } from "../../../shared/auth/session.js";
import { DomainError } from "../../../shared/kernel/errors.js";
import { ContentBacklogs } from "../application/content-backlogs.js";

/** Admin → Content: the paid backlogs (OCR, questions, topics). Seeing and running them needs library:process. */
@ApiTags("content")
@Controller("admin/content")
@RequireActiveOrg()
@MemberHasPermission({ permissions: { library: ["process"] } })
export class ContentController {
  constructor(private readonly backlogs: ContentBacklogs) {}

  @Get("backlogs")
  @ApiResponse({ status: 200, standardSchema: BacklogOverview })
  overview(@Session() session: UserSession): Promise<BacklogOverview> {
    return this.backlogs.overview(activeOrg(session));
  }

  @Post("backlogs/:kind/run")
  @HttpCode(202)
  @Audit({ action: "library.backlog_run", entityType: "backlog" })
  @ApiResponse({ status: 202, standardSchema: BacklogRun })
  run(
    @Session() session: UserSession,
    @Param("kind") kind: string,
    @Body({ schema: RunBacklogRequest }) body: RunBacklogRequest,
  ): Promise<BacklogRun> {
    const parsed = BacklogKind.safeParse(kind);
    if (!parsed.success) throw new DomainError(`No backlog called "${kind}".`, "not_found");
    return this.backlogs.run(activeOrg(session), session.user.id, parsed.data, body.limit);
  }
}
