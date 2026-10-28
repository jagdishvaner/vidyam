import { z } from "zod";

import { CodePath } from "./catalog.js";
import { Uuid } from "./common.js";
import { LlmProvider } from "./llm.js";
import { QuestionText, QuestionType } from "./question.js";
import { contract } from "./registry.js";
import { WorkflowEnvelope } from "./workflows.js";

/**
 * The content pipeline's model work (plan v3 §5): reading scanned pages (OCR), splitting question papers into
 * questions, and picking syllabus topics. Each runs as a backlog through the Batch APIs at half price, and only
 * when an admin starts it after seeing the cost estimate. Nothing paid starts by itself.
 */

/** What a vision model reads off one page image. */
export const OcrPage = contract(
  "OcrPage",
  z.object({
    /**
     * The page's text in reading order, as Markdown: headings as #, tables as Markdown tables, math as LaTeX
     * between $…$, chemistry as \ce{…}. Hindi in Unicode Devanagari.
     */
    markdown: z.string(),
    /** The page has figures, diagrams or chemical structures that the text can't carry. */
    hasFigures: z.boolean(),
    /** How legible the page was, from 0 (unreadable) to 1 (clean print). */
    legibility: z.number().min(0).max(1),
  }),
  "Structured output of the ocr_text task.",
);
export type OcrPage = z.infer<typeof OcrPage>;

/** One question as printed in a paper, in each language it is printed in. */
export const SegmentedQuestion = contract(
  "SegmentedQuestion",
  z.object({
    /** Its number in the paper. */
    number: z.number().int().positive(),
    qtype: QuestionType,
    hi: QuestionText.nullable(),
    en: QuestionText.nullable(),
    /** The page it starts on. */
    page: z.number().int().positive(),
    /** It refers to a figure, diagram or table that is not in the text. */
    hasFigure: z.boolean(),
  }),
);
export type SegmentedQuestion = z.infer<typeof SegmentedQuestion>;

export const SegmentedPaper = contract(
  "SegmentedPaper",
  z.object({
    /** Every question that starts on the pages asked about, in order. */
    questions: z.array(SegmentedQuestion),
  }),
  "Structured output of the segment task.",
);
export type SegmentedPaper = z.infer<typeof SegmentedPaper>;

export const TopicTag = contract(
  "TopicTag",
  z.object({
    /** A code path from the candidate list. */
    node: CodePath,
    /** How sure the model is that the text is about this node, from 0 to 1. */
    confidence: z.number().min(0).max(1),
  }),
);
export type TopicTag = z.infer<typeof TopicTag>;

export const TopicTags = contract(
  "TopicTags",
  z.object({
    /** The most specific nodes the text teaches or tests, best first (usually one, at most three). */
    tags: z.array(TopicTag),
  }),
  "Structured output of the tag task.",
);
export type TopicTags = z.infer<typeof TopicTags>;

export const BacklogKind = contract("BacklogKind", z.enum(["ocr", "segment", "tag"]));
export type BacklogKind = z.infer<typeof BacklogKind>;

/** What running a backlog would do and cost, worked out before anything is sent. */
export const BacklogEstimate = contract(
  "BacklogEstimate",
  z.object({
    kind: BacklogKind,
    /** Pages to read, papers to split, or chunks and questions to tag. */
    items: z.number().int().nonnegative(),
    /** Model requests that makes (a paper is split a few pages per request). */
    requests: z.number().int().nonnegative(),
    modelId: z.string().nullable(),
    /** Who would answer: a provider, or the stub (free) while no key is set. */
    provider: LlmProvider.nullable(),
    /** At Batch API prices (half the normal price); 0 on the stub. */
    costUsd: z.number().nonnegative(),
    /** Why it can't run now (no route, no prompt, budget used up), or null. */
    blocked: z.string().nullable(),
  }),
);
export type BacklogEstimate = z.infer<typeof BacklogEstimate>;

export const BacklogRun = contract(
  "BacklogRun",
  z.object({
    kind: BacklogKind,
    workflowId: z.string(),
    status: z.enum(["running", "completed", "failed"]),
    startedAt: z.iso.datetime({ offset: true }),
  }),
);
export type BacklogRun = z.infer<typeof BacklogRun>;

/** The AI engine's estimates for every backlog of a center. */
export const BacklogEstimates = contract(
  "BacklogEstimates",
  z.object({ backlogs: z.array(BacklogEstimate) }),
);
export type BacklogEstimates = z.infer<typeof BacklogEstimates>;

/** Admin → Content: what is waiting, what it would cost, and what is running. */
export const BacklogOverview = contract(
  "BacklogOverview",
  z.object({
    /** Empty when the AI engine can't be reached. */
    backlogs: z.array(BacklogEstimate),
    runs: z.array(BacklogRun),
    reachable: z.boolean(),
  }),
);
export type BacklogOverview = z.infer<typeof BacklogOverview>;

export const RunBacklogRequest = contract(
  "RunBacklogRequest",
  z.object({ limit: z.number().int().positive().max(100_000).nullable() }),
);
export type RunBacklogRequest = z.infer<typeof RunBacklogRequest>;

export const RunBacklogInput = contract(
  "RunBacklogInput",
  WorkflowEnvelope.extend({
    kind: BacklogKind,
    /** At most this many items in this run (the rest wait for the next); null for all of them. */
    limit: z.number().int().positive().nullable(),
  }),
  "Run one backlog for a center: submit its batches, wait for them, store the results.",
);
export type RunBacklogInput = z.infer<typeof RunBacklogInput>;

export const RunBacklogResult = contract(
  "RunBacklogResult",
  z.object({
    kind: BacklogKind,
    items: z.number().int().nonnegative(),
    batches: z.array(Uuid),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
  }),
  "What running a backlog did.",
);
export type RunBacklogResult = z.infer<typeof RunBacklogResult>;
