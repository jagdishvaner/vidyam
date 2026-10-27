import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  MemberHasPermission,
  RequireActiveOrg,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import {
  LIBRARY_PAGE_SIZE,
  LibraryPage,
  LibraryQuery,
  LibrarySourceDetail,
  LibrarySummary,
} from "@vidyam/contracts";

import { BrowseLibrary } from "../application/browse-library.js";
import { RemoveSource } from "../application/remove-source.js";

const activeOrg = (session: UserSession) =>
  (session.session as { activeOrganizationId: string }).activeOrganizationId;

/** Everyone in a center can browse its library; removing a file needs library:remove. */
@ApiTags("library")
@Controller("library")
@RequireActiveOrg()
export class LibraryController {
  constructor(
    private readonly browse: BrowseLibrary,
    private readonly removeSource: RemoveSource,
  ) {}

  @Get("summary")
  @ApiResponse({ status: 200, standardSchema: LibrarySummary })
  summary(@Session() session: UserSession): Promise<LibrarySummary> {
    return this.browse.summary(activeOrg(session));
  }

  @Get()
  @ApiResponse({ status: 200, standardSchema: LibraryPage })
  list(
    @Session() session: UserSession,
    @Query({ schema: LibraryQuery }) query: LibraryQuery,
  ): Promise<LibraryPage> {
    return this.browse.list(activeOrg(session), query, LIBRARY_PAGE_SIZE);
  }

  @Get(":sourceId")
  @ApiResponse({ status: 200, standardSchema: LibrarySourceDetail })
  detail(
    @Session() session: UserSession,
    @Param("sourceId", new ParseUUIDPipe()) sourceId: string,
  ): Promise<LibrarySourceDetail> {
    return this.browse.detail(activeOrg(session), sourceId);
  }

  @Delete(":sourceId")
  @HttpCode(204)
  @MemberHasPermission({ permissions: { library: ["remove"] } })
  async remove(
    @Session() session: UserSession,
    @Param("sourceId", new ParseUUIDPipe()) sourceId: string,
  ): Promise<void> {
    await this.removeSource.execute(activeOrg(session), sourceId);
  }
}
