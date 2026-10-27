import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  MemberHasPermission,
  RequireActiveOrg,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import {
  ImportPaperPatternsRequest,
  ImportSummary,
  PaperPattern,
  SavePaperPatternRequest,
} from "@vidyam/contracts";
import { z } from "zod";

import { Audit } from "../../../shared/audit/audit.js";
import { activeOrg } from "../../../shared/auth/session.js";
import {
  ImportPaperPatterns,
  ListPaperPatterns,
  RetirePaperPattern,
  SavePaperPattern,
} from "../application/manage-patterns.js";

const MANAGE = { permissions: { syllabus: ["manage"] } };
const PatternQuery = z.object({ examId: z.uuid().optional() });

/** Exam paper patterns: everyone reads them (the chat plans papers from them); syllabus:manage edits them. */
@ApiTags("syllabus")
@Controller("patterns")
@RequireActiveOrg()
export class PatternsController {
  constructor(
    private readonly listPatterns: ListPaperPatterns,
    private readonly savePattern: SavePaperPattern,
    private readonly importPatterns: ImportPaperPatterns,
    private readonly retirePattern: RetirePaperPattern,
  ) {}

  @Get()
  @ApiResponse({ status: 200, standardSchema: PaperPattern.array() })
  list(
    @Session() session: UserSession,
    @Query({ schema: PatternQuery }) query: z.infer<typeof PatternQuery>,
  ): Promise<PaperPattern[]> {
    return this.listPatterns.execute(activeOrg(session), query.examId);
  }

  @Post()
  @Audit({
    action: "pattern.create",
    entityType: "pattern",
    entityId: ({ result }) => (result as PaperPattern).id,
  })
  @MemberHasPermission(MANAGE)
  @ApiResponse({ status: 201, standardSchema: PaperPattern })
  create(
    @Session() session: UserSession,
    @Body({ schema: SavePaperPatternRequest }) body: SavePaperPatternRequest,
  ): Promise<PaperPattern> {
    return this.savePattern.create(activeOrg(session), body);
  }

  @Put(":patternId")
  @Audit({
    action: "pattern.update",
    entityType: "pattern",
    entityId: ({ result }) => (result as PaperPattern).id,
  })
  @MemberHasPermission(MANAGE)
  @ApiResponse({ status: 200, standardSchema: PaperPattern })
  update(
    @Session() session: UserSession,
    @Param("patternId", new ParseUUIDPipe()) patternId: string,
    @Body({ schema: SavePaperPatternRequest }) body: SavePaperPatternRequest,
  ): Promise<PaperPattern> {
    return this.savePattern.update(activeOrg(session), patternId, body);
  }

  @Post("import")
  @Audit({
    action: "pattern.import",
    entityType: "pattern",
    entityId: ({ body }) => `${(body as ImportPaperPatternsRequest).blueprints.length} patterns`,
    data: ({ result }) => ({ ...(result as ImportSummary) }),
  })
  @HttpCode(200)
  @MemberHasPermission(MANAGE)
  @ApiResponse({ status: 200, standardSchema: ImportSummary })
  import(
    @Session() session: UserSession,
    @Body({ schema: ImportPaperPatternsRequest }) body: ImportPaperPatternsRequest,
  ): Promise<ImportSummary> {
    return this.importPatterns.execute(activeOrg(session), body.blueprints);
  }

  @Delete(":patternId")
  @Audit({ action: "pattern.retire", entityType: "pattern" })
  @HttpCode(204)
  @MemberHasPermission(MANAGE)
  async retire(
    @Session() session: UserSession,
    @Param("patternId", new ParseUUIDPipe()) patternId: string,
  ): Promise<void> {
    await this.retirePattern.execute(activeOrg(session), patternId);
  }
}
