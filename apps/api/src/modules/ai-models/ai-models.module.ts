import { Module } from "@nestjs/common";

import { ENV, type Env } from "../../config/env.js";
import { AI_ENGINE, AI_STORE, AiSettings } from "./application/manage-ai.js";
import { PROMPT_STORE, PromptAdmin } from "./application/manage-prompts.js";
import { DrizzleAiStore } from "./infrastructure/drizzle-ai-store.js";
import { DrizzlePromptStore } from "./infrastructure/drizzle-prompt-store.js";
import { HttpAiEngine } from "./infrastructure/http-ai-engine.js";
import { AiController } from "./interface/ai.controller.js";
import { PromptsController } from "./interface/prompts.controller.js";

/** Composition root for Admin → AI models and Prompts. The API never calls an LLM itself (ADR 0008). */
@Module({
  controllers: [AiController, PromptsController],
  providers: [
    AiSettings,
    { provide: AI_STORE, useClass: DrizzleAiStore },
    { provide: AI_ENGINE, inject: [ENV], useFactory: (env: Env) => new HttpAiEngine(env) },
    PromptAdmin,
    { provide: PROMPT_STORE, useClass: DrizzlePromptStore },
  ],
})
export class AiModelsModule {}
