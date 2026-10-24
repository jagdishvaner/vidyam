import { defineConfig } from "eslint/config";

/**
 * Only the Python AI engine (apps/ai) may talk to LLM providers, embedding models or the vector database,
 * so caching rules, model routing and cost tracking exist in exactly one place.
 * Applied to apps/api and apps/web.
 */
export const BANNED_AI_PACKAGES = [
  "@anthropic-ai/*",
  "openai",
  "openai/*",
  "ai",
  "@ai-sdk/*",
  "langchain",
  "@langchain/*",
  "llamaindex",
  "voyageai",
  "cohere-ai",
  "@qdrant/*",
];

export default defineConfig([
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: BANNED_AI_PACKAGES,
              message:
                "LLM, embedding and vector calls belong to the Python AI engine (apps/ai). Call it via the internal API or a BullMQ job.",
            },
          ],
        },
      ],
    },
  },
]);
