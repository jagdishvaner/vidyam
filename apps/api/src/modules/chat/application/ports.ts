import type {
  ChatBlock,
  ChatEngineEvent,
  ChatEngineTurn,
  ChatSessionDetail,
  ChatSessionStatus,
  ChatSessionSummary,
  ChatSessionUpdate,
  ChatStreamEvent,
  ChatTurnStatus,
  DraftSpec,
} from "@vidyam/contracts";

import type { CardNames } from "../domain/turns.js";

/** A turn as stored; every read is limited to the signed-in teacher's own chats. */
export interface TurnRecord {
  id: string;
  sessionId: string;
  userMessageId: string | null;
  /** Set once the answer is stored. */
  assistantMessageId: string | null;
  status: ChatTurnStatus;
  createdAt: Date;
}

export interface NewTurn {
  clientTurnId: string;
  blocks: ChatBlock[];
  /** Turns begun before this and still unanswered are marked failed first (see TURN_TIMEOUT_MS). */
  staleBefore: Date;
}

export type BeginTurn =
  | { kind: "created"; turn: TurnRecord }
  /** The same clientTurnId was sent before: that turn, unchanged. */
  | { kind: "existing"; turn: TurnRecord }
  /** Another turn of this chat is still being answered. */
  | { kind: "busy" };

export interface FinishedTurn {
  turnId: string;
  sessionId: string;
  assistantMessageId: string;
  blocks: ChatBlock[];
  modelId: string | null;
  status: "done" | "failed";
  error: string | null;
  /** Set only when the chat has no title yet. */
  title: string | null;
  sessionStatus: ChatSessionStatus;
  draftSpec: DraftSpec | null;
}

/** Port: chats, messages and turns (Postgres, under the center's row-level security). */
export interface ChatStore {
  list(
    orgId: string,
    userId: string,
    query: { q?: string; archived: boolean; offset: number; limit: number },
  ): Promise<ChatSessionSummary[]>;
  create(orgId: string, userId: string, modelId: string | null): Promise<ChatSessionSummary>;
  detail(orgId: string, userId: string, sessionId: string, now: Date): Promise<ChatSessionDetail | null>;
  update(
    orgId: string,
    userId: string,
    sessionId: string,
    update: ChatSessionUpdate,
  ): Promise<ChatSessionSummary | null>;
  /** Models teachers may pick, as the center allows them. */
  selectableModels(orgId: string): Promise<string[]>;
  /** English names of exams (by code), syllabus nodes and paper patterns (by id) a card's answer refers to. */
  names(
    orgId: string,
    refs: { examCodes: string[]; nodeIds: string[]; blueprintIds: string[] },
  ): Promise<CardNames>;

  /** The turn already made for this clientTurnId, if any (a retried request). */
  existingTurn(
    orgId: string,
    userId: string,
    sessionId: string,
    clientTurnId: string,
  ): Promise<TurnRecord | null>;
  /** In one transaction: the teacher's message and the turn, or the turn already made for clientTurnId. */
  beginTurn(orgId: string, userId: string, sessionId: string, turn: NewTurn): Promise<BeginTurn | null>;
  /** In one transaction: the assistant's message, the turn's outcome, and the chat's title and status. */
  finishTurn(orgId: string, finished: FinishedTurn): Promise<void>;
  turn(orgId: string, userId: string, turnId: string): Promise<TurnRecord | null>;
  failTurn(orgId: string, turnId: string, error: string): Promise<void>;
}

/** Port: the monthly AI budgets (the center's, and the teacher's own). */
export interface BudgetGate {
  /** Why the teacher can't spend more this month, or null when they can. */
  exhausted(orgId: string, userId: string, now: Date): Promise<string | null>;
}

/** Port: the AI engine's chat endpoint (internal HTTP, NDJSON). */
export interface ChatEngine {
  answer(turn: ChatEngineTurn, signal: AbortSignal): AsyncIterable<ChatEngineEvent>;
}

export interface StoredEvent {
  id: string;
  event: ChatStreamEvent;
}

/** Port: a turn's events, kept for a while so a dropped connection resumes (Valkey streams). */
export interface TurnEvents {
  publish(turnId: string, event: ChatStreamEvent): Promise<string>;
  /** After the last event: the stream expires a while later. */
  close(turnId: string): Promise<void>;
  /** A reader for one browser connection; close it when the connection ends. */
  reader(): TurnEventReader;
}

export interface TurnEventReader {
  /** Events after `after` (from the start when null), waiting up to `waitMs` for the first. */
  next(turnId: string, after: string | null, waitMs: number): Promise<StoredEvent[]>;
  close(): void;
}

export const CHAT_STORE = Symbol("CHAT_STORE");
export const BUDGET_GATE = Symbol("BUDGET_GATE");
export const CHAT_ENGINE = Symbol("CHAT_ENGINE");
export const TURN_EVENTS = Symbol("TURN_EVENTS");
