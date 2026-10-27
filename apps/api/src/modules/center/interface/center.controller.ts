import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Post,
  Put,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBody, ApiConsumes, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  MemberHasPermission,
  RequireActiveOrg,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import { AiPolicy, CenterProfile, LOGO_MAX_BYTES, UpdateBrandingRequest } from "@vidyam/contracts";

import { Audit } from "../../../shared/audit/audit.js";
import { activeOrg } from "../../../shared/auth/session.js";
import { DomainError } from "../../../shared/kernel/errors.js";
import { CenterSettings } from "../application/manage-center.js";

/** Everyone in a center reads its profile (exports and the chat use it); admins change it. */
@ApiTags("center")
@Controller("center")
@RequireActiveOrg()
export class CenterController {
  constructor(private readonly center: CenterSettings) {}

  @Get()
  @ApiResponse({ status: 200, standardSchema: CenterProfile })
  profile(@Session() session: UserSession): Promise<CenterProfile> {
    return this.center.profile(activeOrg(session));
  }

  @Put("branding")
  @Audit({ action: "center.branding", entityType: "center", entityId: () => "branding" })
  @HttpCode(204)
  @MemberHasPermission({ permissions: { settings: ["manage"] } })
  async branding(
    @Session() session: UserSession,
    @Body({ schema: UpdateBrandingRequest }) body: UpdateBrandingRequest,
  ): Promise<void> {
    await this.center.updateBranding(activeOrg(session), body);
  }

  @Put("ai-policy")
  @Audit({ action: "center.ai_policy", entityType: "center", entityId: () => "ai_policy" })
  @HttpCode(204)
  @MemberHasPermission({ permissions: { ai: ["manage"] } })
  async aiPolicy(@Session() session: UserSession, @Body({ schema: AiPolicy }) body: AiPolicy): Promise<void> {
    await this.center.updateAiPolicy(activeOrg(session), body);
  }

  @Post("logo")
  @Audit({
    action: "center.logo_set",
    entityType: "center",
    entityId: () => "logo",
    data: ({ result }) => ({ ...(result as object) }),
  })
  @HttpCode(200)
  @MemberHasPermission({ permissions: { settings: ["manage"] } })
  @UseInterceptors(FileInterceptor("logo", { limits: { fileSize: LOGO_MAX_BYTES, files: 1 } }))
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: { type: "object", properties: { logo: { type: "string", format: "binary" } } } })
  async uploadLogo(
    @Session() session: UserSession,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ): Promise<{ logoUrl: string }> {
    if (!file) throw new DomainError("Choose an image file to upload.", "invalid");
    return { logoUrl: await this.center.setLogo(activeOrg(session), new Uint8Array(file.buffer)) };
  }

  @Delete("logo")
  @Audit({ action: "center.logo_remove", entityType: "center", entityId: () => "logo" })
  @HttpCode(204)
  @MemberHasPermission({ permissions: { settings: ["manage"] } })
  async removeLogo(@Session() session: UserSession): Promise<void> {
    await this.center.removeLogo(activeOrg(session));
  }

  @Get("logo")
  @Header("Cache-Control", "private, max-age=86400")
  @Header("X-Content-Type-Options", "nosniff")
  async logo(@Session() session: UserSession): Promise<StreamableFile> {
    const { bytes, contentType } = await this.center.logo(activeOrg(session));
    return new StreamableFile(bytes, { type: contentType, length: bytes.byteLength });
  }
}
