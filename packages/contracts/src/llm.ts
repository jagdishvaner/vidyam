import { z } from "zod";

import { contract } from "./registry.js";

/**
 * Every kind of model call the platform makes. task_routes maps each to a model and effort; the usage ledger
 * records which task every call served.
 */
export const LlmTask = contract(
  "LlmTask",
  z.enum([
    "ocr_text",
    "ocr_math",
    "segment",
    "tag",
    "context_header",
    "query_understanding",
    "spec",
    "chat_title",
    "chat_qa",
    "generate",
    "notes_write",
    "edit_agent",
    "verify_grounding",
    "verify_solve",
    "lint",
    "bilingual_check",
  ]),
);
export type LlmTask = z.infer<typeof LlmTask>;

export const LlmProvider = contract("LlmProvider", z.enum(["anthropic", "openai", "stub"]));
export type LlmProvider = z.infer<typeof LlmProvider>;

export const Effort = contract("Effort", z.enum(["low", "medium", "high", "xhigh", "max"]));
export type Effort = z.infer<typeof Effort>;

/** One model in the platform's registry (global, shared by every center). */
export const AiModel = contract(
  "AiModel",
  z.object({
    id: z.string(),
    provider: LlmProvider,
    apiModel: z.string(),
    displayName: z.string(),
    contextWindow: z.number().int(),
    maxOutputTokens: z.number().int(),
    /** US$ per million tokens, by kind (input, output, cache_read, …). */
    prices: z.record(z.string(), z.number()),
    enabled: z.boolean(),
    teacherSelectable: z.boolean(),
  }),
);
export type AiModel = z.infer<typeof AiModel>;

/** Which model serves a task for this center: the platform default, or the center's own choice. */
export const TaskRoute = contract(
  "TaskRoute",
  z.object({
    task: LlmTask,
    modelId: z.string().nullable(),
    effort: Effort.nullable(),
    maxTokens: z.number().int().positive().nullable(),
    fallbackModelId: z.string().nullable(),
    source: z.enum(["default", "center", "none"]),
  }),
);
export type TaskRoute = z.infer<typeof TaskRoute>;

export const SetTaskRouteRequest = contract(
  "SetTaskRouteRequest",
  z.object({
    modelId: z.string().min(1),
    effort: Effort.nullable(),
    maxTokens: z.number().int().min(256).max(200_000),
    fallbackModelId: z.string().min(1).nullable(),
  }),
);
export type SetTaskRouteRequest = z.infer<typeof SetTaskRouteRequest>;

export const UpdateAiModelRequest = contract(
  "UpdateAiModelRequest",
  z.object({ enabled: z.boolean(), teacherSelectable: z.boolean() }),
);
export type UpdateAiModelRequest = z.infer<typeof UpdateAiModelRequest>;

/**
 * Whether the AI engine can reach a provider. Keys never leave the engine: this only says whether one is set.
 * "stub" means the built-in test model answers instead (no key yet, or switched on for development).
 */
export const ProviderStatus = contract(
  "ProviderStatus",
  z.object({
    provider: z.enum(["anthropic", "openai"]),
    configured: z.boolean(),
    /** How Claude is reached: the first-party API or Claude Platform on AWS. */
    endpoint: z.string().nullable(),
  }),
);
export type ProviderStatus = z.infer<typeof ProviderStatus>;

export const AiEngineStatus = contract(
  "AiEngineStatus",
  z.object({
    providers: z.array(ProviderStatus),
    /** Calls go to the stub: forced on, or no provider key is configured. */
    stubActive: z.boolean(),
  }),
);
export type AiEngineStatus = z.infer<typeof AiEngineStatus>;

export const AiOverview = contract(
  "AiOverview",
  z.object({
    models: z.array(AiModel),
    routes: z.array(TaskRoute),
    /** Null when the AI engine can't be reached. */
    engine: AiEngineStatus.nullable(),
    /** Only the platform admin edits the global model registry; centers choose routes and teacher models. */
    canEditModels: z.boolean(),
  }),
);
export type AiOverview = z.infer<typeof AiOverview>;

/** Prompts are tuned per model family: a prompt that suits Claude is not assumed to suit GPT. */
export const PromptFamily = contract("PromptFamily", z.enum(["claude", "gpt", "any"]));
export type PromptFamily = z.infer<typeof PromptFamily>;

export const PromptVersion = contract(
  "PromptVersion",
  z.object({
    id: z.uuid(),
    /** The task the prompt serves. */
    name: LlmTask,
    modelFamily: PromptFamily,
    version: z.number().int().positive(),
    body: z.string(),
    isActive: z.boolean(),
    /** "package": shipped with the code (packages/prompts); "admin": written in the admin panel. */
    source: z.enum(["package", "admin"]),
    createdByName: z.string().nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  }),
);
export type PromptVersion = z.infer<typeof PromptVersion>;

export const PromptsOverview = contract(
  "PromptsOverview",
  z.object({
    versions: z.array(PromptVersion),
    /** Prompts are shared by every center, so only the platform admin edits and activates them. */
    canEdit: z.boolean(),
  }),
);
export type PromptsOverview = z.infer<typeof PromptsOverview>;

export const CreatePromptVersionRequest = contract(
  "CreatePromptVersionRequest",
  z.object({ name: LlmTask, modelFamily: PromptFamily, body: z.string().trim().min(20).max(60_000) }),
);
export type CreatePromptVersionRequest = z.infer<typeof CreatePromptVersionRequest>;
