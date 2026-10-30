import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
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
  DocumentExport,
  DocumentListItem,
  DocumentListQuery,
  ExportRequest,
  DocumentRestoreRequest,
  DocumentVersion,
  DocumentVersionSummary,
} from "@vidyam/contracts";

import { activeOrg } from "../../../shared/auth/session.js";
import { ExportDocuments } from "../application/export-documents.js";
import { ManageDocuments } from "../application/manage-documents.js";
import { applyEdits } from "../domain/edits.js";

const EDIT = { permissions: { document: ["edit"] } };
const EXPORT = { permissions: { document: ["export"] } };

/**
 * The canvas (plan v3 §2, step 27): a teacher's own papers and notes, their versions, edits and undo. A
 * document is only ever its owner's, like the chat it was made in.
 */
@ApiTags("documents")
@Controller("documents")
@RequireActiveOrg()
export class DocumentsController {
  constructor(
    private readonly documents: ManageDocuments,
    private readonly exports: ExportDocuments,
  ) {}

  /** The teacher's documents, most recently changed first (the dashboard). */
  @Get()
  @MemberHasPermission(EDIT)
  @ApiResponse({ status: 200, standardSchema: DocumentListItem.array() })
  list(
    @Session() session: UserSession,
    @Query({ schema: DocumentListQuery }) query: DocumentListQuery,
  ): Promise<DocumentListItem[]> {
    return this.documents.list(activeOrg(session), session.user.id, query.limit);
  }

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

  /** A PDF or Word file of the current version (plan v3 step 29); it is made in the background. */
  @Post(":documentId/exports")
  @MemberHasPermission(EXPORT)
  @ApiResponse({ status: 201, standardSchema: DocumentExport })
  requestExport(
    @Session() session: UserSession,
    @Param("documentId", ParseUUIDPipe) documentId: string,
    @Body({ schema: ExportRequest }) body: ExportRequest,
  ): Promise<DocumentExport> {
    return this.exports.request(activeOrg(session), session.user.id, documentId, body);
  }

  @Get(":documentId/exports")
  @MemberHasPermission(EXPORT)
  @ApiResponse({ status: 200, standardSchema: DocumentExport.array() })
  listExports(
    @Session() session: UserSession,
    @Param("documentId", ParseUUIDPipe) documentId: string,
  ): Promise<DocumentExport[]> {
    return this.exports.list(activeOrg(session), session.user.id, documentId);
  }

  @Get(":documentId/exports/:exportId/file")
  @MemberHasPermission(EXPORT)
  @Header("Cache-Control", "private, max-age=3600")
  @Header("X-Content-Type-Options", "nosniff")
  async download(
    @Session() session: UserSession,
    @Param("documentId", ParseUUIDPipe) documentId: string,
    @Param("exportId", ParseUUIDPipe) exportId: string,
  ): Promise<StreamableFile> {
    const file = await this.exports.download(activeOrg(session), session.user.id, documentId, exportId);
    // A plain-ASCII name for old browsers, the real one (Hindi titles and all) for the rest (RFC 6266).
    const ascii = file.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
    return new StreamableFile(file.bytes, {
      type: file.contentType,
      length: file.bytes.byteLength,
      disposition: `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    });
  }
}
