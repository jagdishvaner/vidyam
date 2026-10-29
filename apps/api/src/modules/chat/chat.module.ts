import { Module } from "@nestjs/common";
import type { Client } from "@temporalio/client";
import type { Redis } from "ioredis";

import { ENV, type Env } from "../../config/env.js";
import { CACHE_REDIS } from "../../shared/cache/cache.module.js";
import { TEMPORAL_CLIENT } from "../../shared/temporal/temporal.module.js";
import { FollowTurn } from "./application/follow-turn.js";
import { ManageChats } from "./application/manage-chats.js";
import {
  BUDGET_GATE,
  CHAT_ENGINE,
  CHAT_STORE,
  GENERATION_STARTER,
  TURN_EVENTS,
} from "./application/ports.js";
import { SendTurn } from "./application/send-turn.js";
import { DrizzleBudgetGate } from "./infrastructure/drizzle-budget-gate.js";
import { DrizzleChatStore } from "./infrastructure/drizzle-chat-store.js";
import { HttpChatEngine } from "./infrastructure/http-chat-engine.js";
import { TemporalGenerationStarter } from "./infrastructure/temporal-generation-starter.js";
import { ValkeyTurnEvents } from "./infrastructure/valkey-turn-events.js";
import { ChatController } from "./interface/chat.controller.js";

/** Composition root for the chat (plan v3 §6, ADR 0015). The AI engine answers; this module stores. */
@Module({
  controllers: [ChatController],
  providers: [
    ManageChats,
    SendTurn,
    FollowTurn,
    { provide: CHAT_STORE, useClass: DrizzleChatStore },
    { provide: BUDGET_GATE, useClass: DrizzleBudgetGate },
    { provide: CHAT_ENGINE, inject: [ENV], useFactory: (env: Env) => new HttpChatEngine(env) },
    {
      provide: GENERATION_STARTER,
      inject: [TEMPORAL_CLIENT],
      useFactory: (client: Client) => new TemporalGenerationStarter(client),
    },
    {
      provide: TURN_EVENTS,
      inject: [CACHE_REDIS],
      useFactory: (redis: Redis) => new ValkeyTurnEvents(redis),
    },
  ],
  exports: [ManageChats],
})
export class ChatModule {}
