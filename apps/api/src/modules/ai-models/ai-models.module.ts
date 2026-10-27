import { Module } from "@nestjs/common";

import { ENV, type Env } from "../../config/env.js";
import { AI_ENGINE, AI_STORE, AiSettings } from "./application/manage-ai.js";
import { DrizzleAiStore } from "./infrastructure/drizzle-ai-store.js";
import { HttpAiEngine } from "./infrastructure/http-ai-engine.js";
import { AiController } from "./interface/ai.controller.js";

/** Composition root for Admin → AI models. The API never calls an LLM itself (ADR 0008). */
@Module({
  controllers: [AiController],
  providers: [
    AiSettings,
    { provide: AI_STORE, useClass: DrizzleAiStore },
    { provide: AI_ENGINE, inject: [ENV], useFactory: (env: Env) => new HttpAiEngine(env) },
  ],
})
export class AiModelsModule {}
