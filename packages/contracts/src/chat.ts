import { z } from "zod";

import { Uuid } from "./common.js";
import { EditOp } from "./paper.js";
import { contract } from "./registry.js";
import { DraftSpec, TaskKind, TaskSpec } from "./tasks.js";

/**
 * The fields a clarification card can ask for. Cards are built by code, not by the model, so the web app
 * knows how to render (and translate) each one; long option lists such as the syllabus tree are fetched live
 * from the API, so stored messages stay small and content counts stay current.
 */
export const CardFieldKey = contract(
  "CardFieldKey",
  z.enum([
    "kind",
    "exam",
    "blueprint",
    "taxonomy_nodes",
    "sections",
    "difficulty_mix",
    "languages",
    "layout",
    "duration",
    "sourcing",
    "student_batch",
    "set_codes",
    "depth",
    "include_examples",
    "include_practice",
    "title",
  ]),
);
export type CardFieldKey = z.infer<typeof CardFieldKey>;

export const CardField = contract(
  "CardField",
  z.object({
    key: CardFieldKey,
    required: z.boolean(),
    /** The value the card opens with: the blueprint's, the teacher's own default, or what the chat understood. */
    suggested: z.unknown().optional(),
  }),
);
export type CardField = z.infer<typeof CardField>;

export const CitationRef = contract(
  "CitationRef",
  z.object({
    chunkId: Uuid,
    sourceId: Uuid,
    filename: z.string(),
    pageStart: z.number().int().nullable(),
    pageEnd: z.number().int().nullable(),
    /** The page number as printed in the book. */
    pageLabel: z.string().nullable(),
    quote: z.string(),
  }),
);
export type CitationRef = z.infer<typeof CitationRef>;

/** How much of a requested topic the bank already covers, shown before generation is confirmed. */
export const TopicAvailability = contract(
  "TopicAvailability",
  z.object({
    nodeId: Uuid,
    name: z.string(),
    fromBank: z.number().int().nonnegative(),
    toGenerate: z.number().int().nonnegative(),
  }),
);
export type TopicAvailability = z.infer<typeof TopicAvailability>;

export const CostEstimate = contract(
  "CostEstimate",
  z.object({
    usdLow: z.number().nonnegative(),
    usdHigh: z.number().nonnegative(),
    minutes: z.number().nonnegative(),
  }),
);
export type CostEstimate = z.infer<typeof CostEstimate>;

/** One piece of a chat message. Messages are lists of blocks, stored provider-neutral (chat_messages.content). */
export const ChatBlock = contract(
  "ChatBlock",
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("text"), text: z.string() }),
    z.object({ type: z.literal("citations"), items: z.array(CitationRef) }),
    z.object({
      type: z.literal("clarification"),
      cardId: z.string(),
      purpose: z.enum(["scope", "shape"]),
      fields: z.array(CardField).min(1),
    }),
    z.object({
      type: z.literal("card_response"),
      cardId: z.string(),
      values: z.record(z.string(), z.unknown()),
      /** The same answer in words, so a different model can read the transcript after a switch. */
      summary: z.string(),
    }),
    z.object({
      type: z.literal("spec_review"),
      spec: TaskSpec,
      availability: z.array(TopicAvailability),
      estimate: CostEstimate,
      /** Set once the teacher pressed Confirm; only that starts paid generation. */
      confirmedAt: z.iso.datetime({ offset: true }).nullable(),
    }),
    z.object({
      type: z.literal("progress"),
      runId: Uuid,
      stage: z.string(),
      done: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }),
    z.object({
      type: z.literal("document_ref"),
      documentId: Uuid,
      title: z.string(),
      kind: TaskKind,
      version: z.number().int().nonnegative(),
    }),
    z.object({
      type: z.literal("edit_summary"),
      documentId: Uuid,
      fromVersion: z.number().int().nonnegative(),
      toVersion: z.number().int().nonnegative(),
      summary: z.string(),
      ops: z.array(EditOp),
    }),
    z.object({ type: z.literal("notice"), level: z.enum(["info", "warning"]), text: z.string() }),
    z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
  ]),
);
export type ChatBlock = z.infer<typeof ChatBlock>;

/** What a teacher sends: words, an answered card, or a button press. */
export const ChatTurnInput = contract(
  "ChatTurnInput",
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("text"), text: z.string().trim().min(1).max(8000) }),
    z.object({
      kind: z.literal("card_submit"),
      cardId: z.string(),
      values: z.record(z.string(), z.unknown()),
    }),
    z.object({
      kind: z.literal("action"),
      action: z.enum(["confirm_spec", "cancel", "undo"]),
      targetId: z.string().optional(),
    }),
  ]),
);
export type ChatTurnInput = z.infer<typeof ChatTurnInput>;

export const ChatTurnRequest = contract(
  "ChatTurnRequest",
  z.object({
    /** Made by the browser, so a retried request never creates a second turn. */
    clientTurnId: z.string().min(8).max(64),
    input: ChatTurnInput,
    /** Model for this turn, from the teacher's allowed list; the session's choice otherwise. */
    modelId: z.string().nullable().optional(),
  }),
);
export type ChatTurnRequest = z.infer<typeof ChatTurnRequest>;

export const ChatSessionStatus = contract(
  "ChatSessionStatus",
  z.enum(["idle", "awaiting_input", "generating"]),
);
export type ChatSessionStatus = z.infer<typeof ChatSessionStatus>;

export const ChatSessionSummary = contract(
  "ChatSessionSummary",
  z.object({
    id: Uuid,
    title: z.string(),
    status: ChatSessionStatus,
    pinned: z.boolean(),
    archived: z.boolean(),
    documentId: Uuid.nullable(),
    modelId: z.string().nullable(),
    updatedAt: z.iso.datetime({ offset: true }),
  }),
);
export type ChatSessionSummary = z.infer<typeof ChatSessionSummary>;

export const ChatMessage = contract(
  "ChatMessage",
  z.object({
    id: Uuid,
    seq: z.number().int().nonnegative(),
    role: z.enum(["user", "assistant"]),
    blocks: z.array(ChatBlock),
    modelId: z.string().nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  }),
);
export type ChatMessage = z.infer<typeof ChatMessage>;

/**
 * Server-sent events for one turn. Text streams as deltas; every other block arrives whole. The stream is
 * resumable: each event has an id, and a reconnect with Last-Event-ID continues where it stopped.
 */
export const ChatStreamEvent = contract(
  "ChatStreamEvent",
  z.discriminatedUnion("event", [
    z.object({ event: z.literal("turn_started"), turnId: Uuid, messageId: Uuid }),
    z.object({ event: z.literal("text_delta"), text: z.string() }),
    z.object({ event: z.literal("block"), block: ChatBlock }),
    z.object({ event: z.literal("draft_spec"), draftSpec: DraftSpec }),
    z.object({ event: z.literal("message_complete"), messageId: Uuid }),
    z.object({ event: z.literal("error"), code: z.string(), message: z.string() }),
  ]),
);
export type ChatStreamEvent = z.infer<typeof ChatStreamEvent>;
