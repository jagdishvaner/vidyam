import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { ApiProduces, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  MemberHasPermission,
  RequireActiveOrg,
  Session,
  type UserSession,
} from "@thallesp/nestjs-better-auth";
import {
  ChatSessionCreate,
  ChatSessionDetail,
  ChatSessionPage,
  ChatSessionQuery,
  ChatSessionSummary,
  ChatSessionUpdate,
  ChatTurnAccepted,
  ChatTurnRequest,
} from "@vidyam/contracts";
import type { Response } from "express";

import { activeOrg } from "../../../shared/auth/session.js";
import { FollowTurn } from "../application/follow-turn.js";
import { ManageChats } from "../application/manage-chats.js";
import { SendTurn } from "../application/send-turn.js";

const CHAT = { permissions: { chat: ["use"] } };
const STREAM_ID = /^\d+-\d+$/;

/**
 * The chat (plan v3 §6, ADR 0015): a teacher's own chats, and turns whose answers stream as Server-Sent
 * Events. Everyone with chat:use; a chat is only ever its owner's.
 */
@ApiTags("chat")
@Controller("chat")
@RequireActiveOrg()
export class ChatController {
  constructor(
    private readonly chats: ManageChats,
    private readonly sendTurn: SendTurn,
    private readonly followTurn: FollowTurn,
  ) {}

  @Get("sessions")
  @MemberHasPermission(CHAT)
  @ApiResponse({ status: 200, standardSchema: ChatSessionPage })
  list(
    @Session() session: UserSession,
    @Query({ schema: ChatSessionQuery }) query: ChatSessionQuery,
  ): Promise<ChatSessionPage> {
    return this.chats.list(activeOrg(session), session.user.id, query);
  }

  @Post("sessions")
  @MemberHasPermission(CHAT)
  @ApiResponse({ status: 201, standardSchema: ChatSessionSummary })
  create(
    @Session() session: UserSession,
    @Body({ schema: ChatSessionCreate }) body: ChatSessionCreate,
  ): Promise<ChatSessionSummary> {
    return this.chats.create(activeOrg(session), session.user.id, body);
  }

  @Get("sessions/:sessionId")
  @MemberHasPermission(CHAT)
  @ApiResponse({ status: 200, standardSchema: ChatSessionDetail })
  detail(
    @Session() session: UserSession,
    @Param("sessionId", new ParseUUIDPipe()) sessionId: string,
  ): Promise<ChatSessionDetail> {
    return this.chats.detail(activeOrg(session), session.user.id, sessionId);
  }

  /** Rename, pin, archive, or change the chat's model. */
  @Patch("sessions/:sessionId")
  @MemberHasPermission(CHAT)
  @ApiResponse({ status: 200, standardSchema: ChatSessionSummary })
  update(
    @Session() session: UserSession,
    @Param("sessionId", new ParseUUIDPipe()) sessionId: string,
    @Body({ schema: ChatSessionUpdate }) body: ChatSessionUpdate,
  ): Promise<ChatSessionSummary> {
    return this.chats.update(activeOrg(session), session.user.id, sessionId, body);
  }

  /** Records the teacher's message and starts the answer; follow it at /chat/turns/:turnId/events. */
  @Post("sessions/:sessionId/turns")
  @HttpCode(202)
  @MemberHasPermission(CHAT)
  @ApiResponse({ status: 202, standardSchema: ChatTurnAccepted })
  turn(
    @Session() session: UserSession,
    @Param("sessionId", new ParseUUIDPipe()) sessionId: string,
    @Body({ schema: ChatTurnRequest }) body: ChatTurnRequest,
  ): Promise<ChatTurnAccepted> {
    return this.sendTurn.execute(activeOrg(session), session.user.id, sessionId, body);
  }

  /**
   * The answer as Server-Sent Events (ChatStreamEvent), from the start or after `Last-Event-ID`, ending with
   * `message_complete` (or `error` when the answer was lost). Comments keep idle connections open.
   */
  @Get("turns/:turnId/events")
  @MemberHasPermission(CHAT)
  @ApiProduces("text/event-stream")
  async events(
    @Session() session: UserSession,
    @Param("turnId", new ParseUUIDPipe()) turnId: string,
    @Headers("last-event-id") lastEventId: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const orgId = activeOrg(session);
    await this.followTurn.open(orgId, session.user.id, turnId);
    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write("retry: 2000\n\n");
    const closed = new AbortController();
    res.on("close", () => closed.abort());
    const after = lastEventId && STREAM_ID.test(lastEventId) ? lastEventId : null;
    try {
      for await (const item of this.followTurn.follow(orgId, session.user.id, turnId, after, closed.signal)) {
        if ("heartbeat" in item) res.write(": keep-alive\n\n");
        else res.write(`id: ${item.id}\nevent: ${item.event.event}\ndata: ${JSON.stringify(item.event)}\n\n`);
      }
    } finally {
      res.end();
    }
  }
}
