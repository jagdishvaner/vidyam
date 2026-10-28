import { z } from "zod";

import { Uuid } from "./common.js";
import { contract } from "./registry.js";

/**
 * Temporal task queues, split by the resource the work needs so heavy work never blocks interactive work
 * (ADR 0013). `worker` is the only service that polls the queue.
 */
export const TASK_QUEUES = {
  /** Workflow code (orchestration only, cheap) and light activities. */
  ai: { name: "ai", worker: "ai" },
  /** CPU-heavy activities: PDF parsing, image work, chemistry, sympy. */
  aiCpu: { name: "ai-cpu", worker: "ai" },
  /** Calls to LLM providers and embedding models, where provider rate limits apply. */
  aiLlm: { name: "ai-llm", worker: "ai" },
  /** PDF and DOCX exports (Node render worker, Phase 7). */
  render: { name: "render", worker: "render" },
} as const;
export type TaskQueue = (typeof TASK_QUEUES)[keyof typeof TASK_QUEUES]["name"];

export const TaskQueue = contract(
  "TaskQueue",
  z.enum(Object.values(TASK_QUEUES).map((q) => q.name) as [TaskQueue, ...TaskQueue[]]),
);

/** Task queues the Python AI engine polls (everything except rendering). */
export const AiTaskQueue = contract(
  "AiTaskQueue",
  z.enum(
    Object.values(TASK_QUEUES)
      .filter((q) => q.worker === "ai")
      .map((q) => q.name) as [TaskQueue, ...TaskQueue[]],
  ),
);

/** Workflow type names: started from TypeScript (the API), implemented in Python (the AI engine). */
export const WORKFLOWS = {
  ping: "Ping",
  ingestSource: "IngestSource",
  llmBatch: "LlmBatch",
  runBacklog: "RunBacklog",
} as const;
export type WorkflowType = (typeof WORKFLOWS)[keyof typeof WORKFLOWS];
export const WorkflowType = contract(
  "WorkflowType",
  z.enum(Object.values(WORKFLOWS) as [WorkflowType, ...WorkflowType[]]),
);

/**
 * Common fields of every workflow input. Inputs carry ids, never content (big payloads bloat workflow
 * history), and a schema version so starters and workers can be deployed independently. Trace context
 * travels in Temporal headers, not here.
 */
export const WorkflowEnvelope = contract(
  "WorkflowEnvelope",
  z.object({
    v: z.literal(1),
    orgId: Uuid,
    requestedBy: Uuid.nullable(),
  }),
);
export type WorkflowEnvelope = z.infer<typeof WorkflowEnvelope>;

export const IngestSourceInput = contract(
  "IngestSourceInput",
  WorkflowEnvelope.extend({
    sourceId: Uuid,
    /**
     * `all` reads the file again; `structure` keeps the stored pages and redoes sections, chunks and tags
     * (after its manifest metadata changed, or OCR filled in pages).
     */
    stages: z.enum(["all", "structure"]).default("all"),
  }),
  "Ingest one file: read its pages, find its sections, chunk and tag it (plan v3 §5).",
);
export type IngestSourceInput = z.infer<typeof IngestSourceInput>;

const count = z.number().int().nonnegative();

export const IngestSourceResult = contract(
  "IngestSourceResult",
  z.object({
    sourceId: Uuid,
    pages: count,
    /** Read from the PDF's own text. */
    textPages: count,
    /** Converted from a legacy Hindi font such as Kruti Dev. */
    legacyFontPages: count,
    /** Scans, damaged text or unconvertible fonts: these wait for vision OCR. */
    ocrPages: count,
    /** Parts of the file mapped to the syllabus (from the manifest, the table of contents or headings). */
    sections: count,
    chunks: count,
    /** Chunks tagged with a syllabus chapter or subject by the rules (manifest, sections). */
    taggedChunks: count,
    /** Chunks with vectors; 0 while the embedding model server isn't running (they wait for it). */
    embeddedChunks: count,
  }),
  "What ingesting one file produced.",
);
export type IngestSourceResult = z.infer<typeof IngestSourceResult>;

export const LlmBatchInput = contract(
  "LlmBatchInput",
  WorkflowEnvelope.extend({ batchId: Uuid }),
  "Wait for a batch already submitted to a provider's Batch API (llm_batches), then collect its results.",
);
export type LlmBatchInput = z.infer<typeof LlmBatchInput>;

export const LlmBatchResult = contract(
  "LlmBatchResult",
  z.object({
    batchId: Uuid,
    succeeded: count,
    failed: count,
    /** At the Batch API's half price. */
    costUsd: z.number().nonnegative(),
  }),
  "What collecting a batch produced.",
);
export type LlmBatchResult = z.infer<typeof LlmBatchResult>;

export const PingInput = contract(
  "PingInput",
  WorkflowEnvelope.extend({ message: z.string() }),
  "A round trip through the AI engine, used by the cross-language contract test and smoke checks.",
);
export type PingInput = z.infer<typeof PingInput>;

export const PingResult = contract("PingResult", z.object({ echo: z.string(), orgId: Uuid }));
export type PingResult = z.infer<typeof PingResult>;

/** Deterministic workflow id: starting the same work twice finds the running workflow instead of a duplicate. */
export function workflowId(type: WorkflowType, ...parts: string[]): string {
  return [type, ...parts].join(":");
}
