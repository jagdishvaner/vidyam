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
