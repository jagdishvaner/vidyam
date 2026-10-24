import { z } from "zod";

import { Uuid } from "./common.js";
import { contract } from "./registry.js";

/**
 * Progress events for long-running work (paper generation, ingestion, export). Written to Valkey Streams by
 * the worker and relayed by the API to the browser as Server-Sent Events, resumable via Last-Event-ID.
 */
export const ProgressEvent = contract(
  "ProgressEvent",
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("stage"),
      stage: z.string(),
      done: z.number().int(),
      total: z.number().int(),
    }),
    z.object({ type: z.literal("item_ready"), itemId: z.string(), questionId: Uuid }),
    z.object({
      type: z.literal("item_verified"),
      itemId: z.string(),
      check: z.string(),
      passed: z.boolean(),
      detail: z.string().nullable(),
    }),
    z.object({ type: z.literal("error"), message: z.string(), retryable: z.boolean() }),
    z.object({ type: z.literal("done") }),
  ]),
);
export type ProgressEvent = z.infer<typeof ProgressEvent>;
