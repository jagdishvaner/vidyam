import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  MemberHasPermission,
  RequireActiveOrg,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import {
  CreateSyllabusNodeRequest,
  ExamPaper,
  ImportExamPapersRequest,
  ImportSummary,
  SyllabusImport,
  SyllabusNode,
  SyllabusOverview,
  SyllabusSubject,
  UpdateSyllabusNodeRequest,
} from "@vidyam/contracts";

import { Audit } from "../../../shared/audit/audit.js";
import { activeOrg } from "../../../shared/auth/session.js";
import {
  BrowseSyllabus,
  DeleteExamPaper,
  EditSyllabus,
  ImportExamPapers,
  ImportSyllabus,
} from "../application/manage-syllabus.js";

const MANAGE = { permissions: { syllabus: ["manage"] } };

/** Everyone reads the syllabus (the chat's pickers need it); changing it needs syllabus:manage. */
@ApiTags("syllabus")
@Controller()
@RequireActiveOrg()
export class SyllabusController {
  constructor(
    private readonly browse: BrowseSyllabus,
    private readonly importSyllabus: ImportSyllabus,
    private readonly edit: EditSyllabus,
    private readonly importExams: ImportExamPapers,
    private readonly deleteExam: DeleteExamPaper,
  ) {}

  @Get("syllabus")
  @ApiResponse({ status: 200, standardSchema: SyllabusOverview })
  overview(@Session() session: UserSession): Promise<SyllabusOverview> {
    return this.browse.overview(activeOrg(session));
  }

  @Get("syllabus/subjects/:subjectId")
  @ApiResponse({ status: 200, standardSchema: SyllabusSubject })
  subject(
    @Session() session: UserSession,
    @Param("subjectId", new ParseUUIDPipe()) subjectId: string,
  ): Promise<SyllabusSubject> {
    return this.browse.subject(activeOrg(session), subjectId);
  }

  @Post("syllabus/import")
  @Audit({
    action: "syllabus.import",
    entityType: "subject",
    entityId: ({ body }) => (body as SyllabusImport).subject.code,
    data: ({ result }) => ({ ...(result as ImportSummary) }),
  })
  @HttpCode(200)
  @MemberHasPermission(MANAGE)
  @ApiResponse({ status: 200, standardSchema: ImportSummary })
  import(
    @Session() session: UserSession,
    @Body({ schema: SyllabusImport }) body: SyllabusImport,
  ): Promise<ImportSummary> {
    return this.importSyllabus.execute(activeOrg(session), body);
  }

  @Post("syllabus/nodes")
  @Audit({
    action: "syllabus.node_create",
    entityType: "syllabus_node",
    entityId: ({ result }) => (result as SyllabusNode).id,
  })
  @MemberHasPermission(MANAGE)
  @ApiResponse({ status: 201, standardSchema: SyllabusNode })
  createNode(
    @Session() session: UserSession,
    @Body({ schema: CreateSyllabusNodeRequest }) body: CreateSyllabusNodeRequest,
  ): Promise<SyllabusNode> {
    return this.edit.create(activeOrg(session), body);
  }

  @Put("syllabus/nodes/:nodeId")
  @Audit({ action: "syllabus.node_update", entityType: "syllabus_node" })
  @MemberHasPermission(MANAGE)
  @ApiResponse({ status: 200, standardSchema: SyllabusNode })
  updateNode(
    @Session() session: UserSession,
    @Param("nodeId", new ParseUUIDPipe()) nodeId: string,
    @Body({ schema: UpdateSyllabusNodeRequest }) body: UpdateSyllabusNodeRequest,
  ): Promise<SyllabusNode> {
    return this.edit.update(activeOrg(session), nodeId, body);
  }

  @Get("exams")
  @ApiResponse({ status: 200, standardSchema: ExamPaper.array() })
  exams(@Session() session: UserSession): Promise<ExamPaper[]> {
    return this.browse.exams(activeOrg(session));
  }

  @Post("exams/import")
  @Audit({
    action: "exam.import",
    entityType: "exam",
    entityId: ({ body }) => (body as ImportExamPapersRequest).exams.map((e) => e.code).join(","),
    data: ({ result }) => ({ ...(result as ImportSummary) }),
  })
  @HttpCode(200)
  @MemberHasPermission(MANAGE)
  @ApiResponse({ status: 200, standardSchema: ImportSummary })
  importExamPapers(
    @Session() session: UserSession,
    @Body({ schema: ImportExamPapersRequest }) body: ImportExamPapersRequest,
  ): Promise<ImportSummary> {
    return this.importExams.execute(activeOrg(session), body.exams);
  }

  @Delete("exams/:examId")
  @Audit({ action: "exam.delete", entityType: "exam" })
  @HttpCode(204)
  @MemberHasPermission(MANAGE)
  async removeExam(
    @Session() session: UserSession,
    @Param("examId", new ParseUUIDPipe()) examId: string,
  ): Promise<void> {
    await this.deleteExam.execute(activeOrg(session), examId);
  }
}
