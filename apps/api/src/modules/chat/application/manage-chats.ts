import { Inject, Injectable } from "@nestjs/common";
import {
  CHAT_SESSION_PAGE_SIZE,
  type ChatSessionCreate,
  type ChatSessionDetail,
  type ChatSessionPage,
  type ChatSessionQuery,
  type ChatSessionSummary,
  type ChatSessionUpdate,
} from "@vidyam/contracts";

import { DomainError } from "../../../shared/kernel/errors.js";
import { CHAT_STORE, type ChatStore } from "./ports.js";

const NOT_FOUND = "That chat doesn't exist.";

/** The chat history (plan v3 §2): a teacher's own chats, to start, find, rename, pin and archive. */
@Injectable()
export class ManageChats {
  constructor(@Inject(CHAT_STORE) private readonly store: ChatStore) {}

  async list(orgId: string, userId: string, query: ChatSessionQuery): Promise<ChatSessionPage> {
    const rows = await this.store.list(orgId, userId, {
      q: query.q || undefined,
      archived: query.show === "archived",
      offset: query.offset,
      limit: CHAT_SESSION_PAGE_SIZE + 1,
    });
    return {
      items: rows.slice(0, CHAT_SESSION_PAGE_SIZE),
      nextOffset: rows.length > CHAT_SESSION_PAGE_SIZE ? query.offset + CHAT_SESSION_PAGE_SIZE : null,
    };
  }

  async create(orgId: string, userId: string, body: ChatSessionCreate): Promise<ChatSessionSummary> {
    await this.checkModel(orgId, body.modelId);
    return this.store.create(orgId, userId, body.modelId);
  }

  async detail(orgId: string, userId: string, sessionId: string): Promise<ChatSessionDetail> {
    const detail = await this.store.detail(orgId, userId, sessionId, new Date());
    if (!detail) throw new DomainError(NOT_FOUND, "not_found");
    return detail;
  }

  async update(
    orgId: string,
    userId: string,
    sessionId: string,
    update: ChatSessionUpdate,
  ): Promise<ChatSessionSummary> {
    await this.checkModel(orgId, update.modelId ?? null);
    const session = await this.store.update(orgId, userId, sessionId, update);
    if (!session) throw new DomainError(NOT_FOUND, "not_found");
    return session;
  }

  /** A chosen model must be one the center lets teachers pick (Admin → AI models). */
  async checkModel(orgId: string, modelId: string | null): Promise<void> {
    if (modelId && !(await this.store.selectableModels(orgId)).includes(modelId)) {
      throw new DomainError("Your center doesn't offer that model.", "invalid");
    }
  }
}
