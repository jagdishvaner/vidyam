import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  MemberHasPermission,
  RequireActiveOrg,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import {
  DocumentDetail,
  DocumentEditRequest,
  DocumentRestoreRequest,
  DocumentVersion,
  DocumentVersionSummary,
} from "@vidyam/contracts";

import { activeOrg } from "../../../shared/auth/session.js";
import { ManageDocuments } from "../application/manage-documents.js";
import { applyEdits } from "../domain/edits.js";

const EDIT = { permissions: { document: ["edit"] } };

/**
 * The canvas (plan v3 §2, step 27): a teacher's own papers and notes, their versions, edits and undo. A
 * document is only ever its owner's, like the chat it was made in.
 */
@ApiTags("documents")
@Controller("documents")
@RequireActiveOrg()
export class DocumentsController {
  constructor(private readonly documents: ManageDocuments) {}

  @Get(":documentId")
  @MemberHasPermission(EDIT)
  @ApiResponse({ status: 200, standardSchema: DocumentDetail })
  detail(
    @Session() session: UserSession,
    @Param("documentId", ParseUUIDPipe) documentId: string,
  ): Promise<DocumentDetail> {
    return this.documents.detail(activeOrg(session), session.user.id, documentId);
  }

  @Get(":documentId/versions")
  @MemberHasPermission(EDIT)
  @ApiResponse({ status: 200, standardSchema: DocumentVersionSummary.array() })
  versions(
    @Session() session: UserSession,
    @Param("documentId", ParseUUIDPipe) documentId: string,
  ): Promise<DocumentVersionSummary[]> {
    return this.documents.versions(activeOrg(session), session.user.id, documentId);
  }

  @Get(":documentId/versions/:version")
  @MemberHasPermission(EDIT)
  @ApiResponse({ status: 200, standardSchema: DocumentVersion })
  version(
    @Session() session: UserSession,
    @Param("documentId", ParseUUIDPipe) documentId: string,
    @Param("version", ParseIntPipe) version: number,
  ): Promise<DocumentVersion> {
    return this.documents.version(activeOrg(session), session.user.id, documentId, version);
  }

  /** Changes made on the canvas, against the version they were made on; 409 if it moved on meanwhile. */
  @Post(":documentId/edits")
  @HttpCode(200)
  @MemberHasPermission(EDIT)
  @ApiResponse({ status: 200, standardSchema: DocumentDetail })
  edit(
    @Session() session: UserSession,
    @Param("documentId", ParseUUIDPipe) documentId: string,
    @Body({ schema: DocumentEditRequest }) body: DocumentEditRequest,
  ): Promise<DocumentDetail> {
    return this.documents.edit(activeOrg(session), session.user.id, documentId, body, applyEdits);
  }

  /** Undo: an earlier version saved again as the newest. */
  @Post(":documentId/restore")
  @HttpCode(200)
  @MemberHasPermission(EDIT)
  @ApiResponse({ status: 200, standardSchema: DocumentDetail })
  restore(
    @Session() session: UserSession,
    @Param("documentId", ParseUUIDPipe) documentId: string,
    @Body({ schema: DocumentRestoreRequest }) body: DocumentRestoreRequest,
  ): Promise<DocumentDetail> {
    return this.documents.restore(activeOrg(session), session.user.id, documentId, body);
  }

  @Delete(":documentId")
  @HttpCode(204)
  @MemberHasPermission(EDIT)
  async remove(
    @Session() session: UserSession,
    @Param("documentId", ParseUUIDPipe) documentId: string,
  ): Promise<void> {
    await this.documents.remove(activeOrg(session), session.user.id, documentId);
  }
}
