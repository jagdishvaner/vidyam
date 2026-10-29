import { z } from "zod";

import { ChatBlock, RewriteRequest } from "./chat.js";
import { Uuid } from "./common.js";
import { EditOp } from "./paper.js";
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
  /** Activities that commit results to the API's tables (ADR 0017): the API is their only writer. */
  api: { name: "api", worker: "api" },
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
  indexSource: "IndexSource",
  generatePaper: "GeneratePaper",
  generateNotes: "GenerateNotes",
  editDocument: "EditDocument",
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
    /** Chunks searchable in the index (Qdrant). */
    indexedChunks: count,
  }),
  "What ingesting one file produced.",
);
export type IngestSourceResult = z.infer<typeof IngestSourceResult>;

export const IndexSourceInput = contract(
  "IndexSourceInput",
  WorkflowEnvelope.extend({ sourceId: Uuid }),
  "Embed a file's chunks that have no vectors yet, then (re)write its points in the search index.",
);
export type IndexSourceInput = z.infer<typeof IndexSourceInput>;

export const IndexSourceResult = contract(
  "IndexSourceResult",
  z.object({ sourceId: Uuid, embeddedChunks: count, indexedChunks: count }),
  "What embedding and indexing one file produced.",
);
export type IndexSourceResult = z.infer<typeof IndexSourceResult>;

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

/**
 * Activities the API runs on the `api` queue for workflows the AI engine runs (ADR 0017): they commit results
 * to the tables only the API writes. Each is safe to retry: Temporal may run one more than once.
 */
export const API_ACTIVITIES = {
  saveDocumentVersion: "save_document_version",
  updateGenerationRun: "update_generation_run",
  appendChatBlocks: "append_chat_blocks",
  applyDocumentEdits: "apply_document_edits",
} as const;
export type ApiActivity = (typeof API_ACTIVITIES)[keyof typeof API_ACTIVITIES];
export const ApiActivity = contract(
  "ApiActivity",
  z.enum(Object.values(API_ACTIVITIES) as [ApiActivity, ...ApiActivity[]]),
);

/** A new version of a document, saved only if the document is still at `baseVersion` (no lost edits). */
export const SaveDocumentVersionInput = contract(
  "SaveDocumentVersionInput",
  z.object({
    v: z.literal(1),
    orgId: Uuid,
    documentId: Uuid,
    baseVersion: z.number().int().nonnegative(),
    content: z.record(z.string(), z.unknown()),
    /** The edit operations that made it from the base version (empty for a fresh generation). */
    ops: z.array(z.unknown()).default([]),
    authorKind: z.enum(["user", "agent", "system"]),
    authorId: Uuid.nullable().default(null),
    chatMessageId: Uuid.nullable().default(null),
  }),
);
export type SaveDocumentVersionInput = z.infer<typeof SaveDocumentVersionInput>;

export const SaveDocumentVersionResult = contract(
  "SaveDocumentVersionResult",
  z.object({
    version: z.number().int().positive(),
    /** False when a retry found this version already saved. */
    created: z.boolean(),
  }),
);
export type SaveDocumentVersionResult = z.infer<typeof SaveDocumentVersionResult>;

export const GenerationStatus = contract(
  "GenerationStatus",
  z.enum(["planning", "running", "done", "failed", "cancelled"]),
);
export type GenerationStatus = z.infer<typeof GenerationStatus>;

/** How a generation run is getting on; fields left out stay as they are, slot states are merged in. */
export const UpdateGenerationRunInput = contract(
  "UpdateGenerationRunInput",
  z.object({
    v: z.literal(1),
    orgId: Uuid,
    runId: Uuid,
    status: GenerationStatus.optional(),
    slotPlan: z.array(z.unknown()).optional(),
    /** Per slot id: its state (pending, bank, generated, verified, flagged, …) and flags. */
    slotStates: z.record(z.string(), z.unknown()).optional(),
    actualCostUsd: z.number().nonnegative().optional(),
    error: z.string().nullable().optional(),
  }),
);
export type UpdateGenerationRunInput = z.infer<typeof UpdateGenerationRunInput>;

export const UpdateGenerationRunResult = contract(
  "UpdateGenerationRunResult",
  z.object({ status: GenerationStatus }),
);
export type UpdateGenerationRunResult = z.infer<typeof UpdateGenerationRunResult>;

/** An assistant message from a workflow (a finished document, say), under an id the workflow fixes. */
export const AppendChatBlocksInput = contract(
  "AppendChatBlocksInput",
  z.object({
    v: z.literal(1),
    orgId: Uuid,
    sessionId: Uuid,
    /** Fixed by the workflow, so a retried activity writes the message once. */
    messageId: Uuid,
    blocks: z.array(ChatBlock).min(1),
  }),
);
export type AppendChatBlocksInput = z.infer<typeof AppendChatBlocksInput>;

export const AppendChatBlocksResult = contract(
  "AppendChatBlocksResult",
  z.object({ messageId: Uuid, created: z.boolean() }),
);
export type AppendChatBlocksResult = z.infer<typeof AppendChatBlocksResult>;

export const GenerateDocumentInput = contract(
  "GenerateDocumentInput",
  WorkflowEnvelope.extend({
    documentId: Uuid,
    runId: Uuid,
    /** The chat it was asked for in: told there when the document is ready. */
    sessionId: Uuid.nullable(),
    /** The teacher's chosen model for writing; the task's route otherwise. */
    modelId: z.string().nullable(),
  }),
  "Make a confirmed paper, worksheet, notes or revision sheet (plan v3 §7).",
);
export type GenerateDocumentInput = z.infer<typeof GenerateDocumentInput>;

export const GenerateDocumentResult = contract(
  "GenerateDocumentResult",
  z.object({
    documentId: Uuid,
    version: z.number().int().positive(),
    /** Slots (papers) or sections (notes), by how they ended: bank, verified, flagged, … */
    outcome: z.record(z.string(), count),
    costUsd: z.number().nonnegative(),
  }),
  "What making a document produced.",
);
export type GenerateDocumentResult = z.infer<typeof GenerateDocumentResult>;

export const EditDocumentInput = contract(
  "EditDocumentInput",
  WorkflowEnvelope.extend({
    documentId: Uuid,
    runId: Uuid,
    sessionId: Uuid.nullable(),
    modelId: z.string().nullable(),
    /** The version the rewritten questions go into; the edit is refused if the document moved on. */
    baseVersion: z.number().int().positive(),
    requests: z.array(RewriteRequest).min(1),
    /** What the teacher asked for, in a line, for the chat's message. */
    summary: z.string(),
  }),
  "Write some of a document's questions or sections again, as asked in the chat (plan v3 §6.9).",
);
export type EditDocumentInput = z.infer<typeof EditDocumentInput>;

/**
 * An edit a workflow made, saved as the next version only if the document is still at `baseVersion`, and
 * told in the chat. One transaction; a retry finds it done by its message id.
 */
export const ApplyDocumentEditsInput = contract(
  "ApplyDocumentEditsInput",
  z.object({
    v: z.literal(1),
    orgId: Uuid,
    documentId: Uuid,
    runId: Uuid,
    baseVersion: z.number().int().positive(),
    ops: z.array(EditOp),
    summary: z.string(),
    sessionId: Uuid.nullable(),
    messageId: Uuid,
  }),
);
export type ApplyDocumentEditsInput = z.infer<typeof ApplyDocumentEditsInput>;

export const ApplyDocumentEditsResult = contract(
  "ApplyDocumentEditsResult",
  z.object({
    /** The version saved; null when nothing was (no changes, or the document had moved on). */
    version: z.number().int().positive().nullable(),
    outcome: z.enum(["saved", "nothing", "moved_on"]),
  }),
);
export type ApplyDocumentEditsResult = z.infer<typeof ApplyDocumentEditsResult>;
