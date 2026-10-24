import { z } from "zod";

import { Uuid } from "./common.js";
import { contract } from "./registry.js";

/**
 * BullMQ queues, split by resource class so heavy work never blocks interactive work (ADR 0005).
 * `consumer` is the only service allowed to process the queue.
 */
export const QUEUES = {
  cpuParse: { name: "cpu-parse", consumer: "ai" },
  llmBatch: { name: "llm-batch", consumer: "ai" },
  llmLive: { name: "llm-live", consumer: "ai" },
  embed: { name: "embed", consumer: "ai" },
  chem: { name: "chem", consumer: "ai" },
  index: { name: "index", consumer: "ai" },
  generate: { name: "generate", consumer: "ai" },
  verify: { name: "verify", consumer: "ai" },
  pool: { name: "pool", consumer: "ai" },
  evaluate: { name: "eval", consumer: "ai" },
  render: { name: "render", consumer: "render" },
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]["name"];

/** Exported so the Python workers consume exactly the queues the API produces to. */
export const QueueName = contract(
  "QueueName",
  z.enum(Object.values(QUEUES).map((q) => q.name) as [QueueName, ...QueueName[]]),
);

/** Queues processed by the Python AI engine (everything except rendering). */
export const AiQueueName = contract(
  "AiQueueName",
  z.enum(
    Object.values(QUEUES)
      .filter((q) => q.consumer === "ai")
      .map((q) => q.name) as [QueueName, ...QueueName[]],
  ),
);

/** BullMQ key prefix shared by every producer and consumer. */
export const QUEUE_PREFIX = "vidyam";
export const QueuePrefix = contract("QueuePrefix", z.literal(QUEUE_PREFIX));

/**
 * Common fields of every job payload. Payloads carry ids only (never content), a schema version so
 * producers and consumers can be deployed independently, and the W3C trace context.
 */
export const JobEnvelope = contract(
  "JobEnvelope",
  z.object({
    v: z.literal(1),
    orgId: Uuid,
    requestedBy: Uuid.nullable(),
    traceparent: z.string().nullable(),
  }),
);
export type JobEnvelope = z.infer<typeof JobEnvelope>;

export const IngestSourceJob = contract(
  "IngestSourceJob",
  JobEnvelope.extend({ kind: z.literal("ingest_source"), sourceId: Uuid }),
  "Start (or resume) the ingestion pipeline for one uploaded file.",
);
export type IngestSourceJob = z.infer<typeof IngestSourceJob>;

export const PingJob = contract(
  "PingJob",
  JobEnvelope.extend({ kind: z.literal("ping"), message: z.string() }),
  "No-op job used by the cross-language queue contract test and health checks.",
);
export type PingJob = z.infer<typeof PingJob>;

/** Deterministic job id so re-enqueueing the same stage is idempotent. */
export function jobId(kind: string, ...parts: string[]): string {
  // BullMQ rejects custom ids containing ":" (its key separator).
  return [kind, ...parts].join(".");
}
