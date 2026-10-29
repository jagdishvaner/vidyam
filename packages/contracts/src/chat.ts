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
    /** Choices the chat offers without choosing them: the chapters a typed name could mean. */
    options: z.array(z.string()).optional(),
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
    /** A button the teacher pressed (Confirm, Cancel, Undo), with what it was pressed on. */
    z.object({
      type: z.literal("action"),
      action: z.enum(["confirm_spec", "cancel", "undo"]),
      targetId: z.string().nullable(),
      /** The press in words, for the transcript. */
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

/** Chat history, newest first with pinned chats on top; `q` searches titles and what was said. */
export const ChatSessionQuery = contract(
  "ChatSessionQuery",
  z.object({
    q: z.string().trim().max(200).optional(),
    show: z.enum(["active", "archived"]).default("active"),
    offset: z.coerce.number().int().nonnegative().default(0),
  }),
);
export type ChatSessionQuery = z.infer<typeof ChatSessionQuery>;

export const CHAT_SESSION_PAGE_SIZE = 30;

export const ChatSessionPage = contract(
  "ChatSessionPage",
  z.object({
    items: z.array(ChatSessionSummary),
    /** Where the next page starts, or null on the last page. */
    nextOffset: z.number().int().nonnegative().nullable(),
  }),
);
export type ChatSessionPage = z.infer<typeof ChatSessionPage>;

export const ChatSessionCreate = contract(
  "ChatSessionCreate",
  z.object({
    /** A model from the center's allowed list; the route's default when null. */
    modelId: z.string().nullable().default(null),
  }),
);
export type ChatSessionCreate = z.infer<typeof ChatSessionCreate>;

export const ChatSessionUpdate = contract(
  "ChatSessionUpdate",
  z
    .object({
      title: z.string().trim().min(1).max(120),
      pinned: z.boolean(),
      archived: z.boolean(),
      modelId: z.string().nullable(),
    })
    .partial()
    .refine((update) => Object.keys(update).length > 0, "nothing to change"),
);
export type ChatSessionUpdate = z.infer<typeof ChatSessionUpdate>;

/** One chat with its messages, oldest first. */
export const ChatSessionDetail = contract(
  "ChatSessionDetail",
  z.object({
    session: ChatSessionSummary,
    draftSpec: DraftSpec.nullable(),
    messages: z.array(ChatMessage),
    /** The turn still being answered, whose events the browser should follow; null when none is. */
    activeTurnId: Uuid.nullable(),
  }),
);
export type ChatSessionDetail = z.infer<typeof ChatSessionDetail>;

export const ChatTurnStatus = contract(
  "ChatTurnStatus",
  z.enum(["pending", "streaming", "done", "failed", "cancelled"]),
);
export type ChatTurnStatus = z.infer<typeof ChatTurnStatus>;

/** The answer to sending a turn: where its answer streams (GET /api/chat/turns/:turnId/events). */
export const ChatTurnAccepted = contract(
  "ChatTurnAccepted",
  z.object({
    turnId: Uuid,
    userMessageId: Uuid,
    /** The assistant message's id, known before it is written. */
    assistantMessageId: Uuid,
    status: ChatTurnStatus,
  }),
);
export type ChatTurnAccepted = z.infer<typeof ChatTurnAccepted>;

/**
 * Internal: the API asks the AI engine to answer a turn, by ids only (ADR 0015). The engine reads the
 * conversation itself and never writes it; the API, the single writer, stores the answer.
 */
export const ChatEngineTurn = contract(
  "ChatEngineTurn",
  z.object({
    orgId: Uuid,
    userId: Uuid,
    sessionId: Uuid,
    turnId: Uuid,
    /** The teacher's message this turn answers; the transcript is read up to it. */
    userMessageId: Uuid,
    /** The model the teacher picked for this turn, or the chat's; null for the route's default. */
    modelId: z.string().nullable(),
  }),
);
export type ChatEngineTurn = z.infer<typeof ChatEngineTurn>;

/**
 * Internal: what the AI engine streams back, one JSON object per line. Text, blocks and the draft spec are
 * relayed to the browser as they come; `done` carries the whole answer for the API to store.
 */
export const ChatEngineEvent = contract(
  "ChatEngineEvent",
  z.discriminatedUnion("event", [
    z.object({ event: z.literal("text_delta"), text: z.string() }),
    z.object({ event: z.literal("block"), block: ChatBlock }),
    z.object({ event: z.literal("draft_spec"), draftSpec: DraftSpec }),
    z.object({
      event: z.literal("done"),
      blocks: z.array(ChatBlock),
      /** The model that answered (its calls are in the usage ledger under this turn's id). */
      modelId: z.string().nullable(),
      /** A title for a chat that has none yet. */
      title: z.string().nullable(),
      sessionStatus: ChatSessionStatus,
    }),
    z.object({ event: z.literal("error"), code: z.string(), message: z.string() }),
  ]),
);
export type ChatEngineEvent = z.infer<typeof ChatEngineEvent>;

/** What the scope card offers: an exam's syllabus (or every subject's chapters), with how much each covers. */
export const ChatScopeQuery = contract(
  "ChatScopeQuery",
  z.object({
    /** The exam's syllabus down to topics; without one, subjects, units and chapters. */
    examCode: z.string().max(80).optional(),
    /** Nodes to include as well, with what is above them (the chat's suggestions), comma-separated. */
    ids: z.string().max(4000).optional(),
  }),
);
export type ChatScopeQuery = z.infer<typeof ChatScopeQuery>;

export const ChatScopeNode = contract(
  "ChatScopeNode",
  z.object({
    id: Uuid,
    parentId: Uuid.nullable(),
    level: z.string(),
    code: z.string(),
    nameEn: z.string(),
    nameHi: z.string().nullable(),
    /** Searchable passages tagged here or below. */
    passages: z.number().int().nonnegative(),
    /** Approved or verified bank questions here or below. */
    questions: z.number().int().nonnegative(),
  }),
);
export type ChatScopeNode = z.infer<typeof ChatScopeNode>;

export const ChatScope = contract("ChatScope", z.object({ nodes: z.array(ChatScopeNode) }));
export type ChatScope = z.infer<typeof ChatScope>;
