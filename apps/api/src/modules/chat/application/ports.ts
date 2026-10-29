import type {
  AppendChatBlocksInput,
  AppendChatBlocksResult,
  ChatBlock,
  ChatEngineEvent,
  ChatEngineTurn,
  ChatScopeNode,
  ChatSessionDetail,
  ChatSessionStatus,
  ChatSessionSummary,
  ChatSessionUpdate,
  ChatStreamEvent,
  ChatTurnStatus,
  DraftSpec,
  EditDocumentInput,
  GenerateDocumentInput,
  RewriteRequest,
  TaskKind,
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

/** What pressing Confirm on a review card made (plan v3 §6.7). */
export interface ConfirmedSpec {
  turn: TurnRecord;
  documentId: string;
  runId: string;
  kind: TaskKind;
  title: string;
}

export type ConfirmSpec =
  | { kind: "confirmed"; confirmed: ConfirmedSpec }
  | { kind: "existing"; turn: TurnRecord }
  | { kind: "busy" }
  /** The chat's latest word isn't a review card: there is nothing to confirm. */
  | { kind: "nothing" };

/** Port: starts a generation workflow (Temporal; the AI engine runs it). */
export interface GenerationStarter {
  start(input: GenerateDocumentInput, kind: TaskKind): Promise<void>;
  /** EditDocument: some of a document's questions or sections written again, as asked in the chat. */
  startEdit(input: EditDocumentInput): Promise<void>;
}

/** What the chat's latest word says about undoing (only an edit the chat just made can be undone). */
export type LatestEdit =
  | { kind: "edit"; documentId: string; fromVersion: number; toVersion: number }
  | { kind: "none" }
  | { kind: "busy" };

/** A rewrite the chat asked for, ready to start: its run, and the version it rewrites. */
export interface BegunRewrite {
  runId: string;
  baseVersion: number;
}
export const GENERATION_STARTER = Symbol("GENERATION_STARTER");

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
  /** Deletes a chat with its messages; false when it isn't the teacher's. Usage stays in the ledger. */
  remove(orgId: string, userId: string, sessionId: string): Promise<boolean>;
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
  /** The scope card's syllabus: the exam's subtree (or every subject's chapters) and the given nodes. */
  scope(orgId: string, examCode: string | null, ids: string[]): Promise<ChatScopeNode[]>;
  /** In one transaction: the teacher's message and the turn, or the turn already made for clientTurnId. */
  beginTurn(orgId: string, userId: string, sessionId: string, turn: NewTurn): Promise<BeginTurn | null>;
  /**
   * In one transaction: the teacher's press, the document (version 0) and its generation run from the spec on
   * the chat's latest review card, and the assistant's message pointing at the document.
   */
  confirmSpec(orgId: string, userId: string, sessionId: string, turn: NewTurn): Promise<ConfirmSpec | null>;
  /** A run that couldn't start: failed, and the chat back to idle. */
  failRun(orgId: string, runId: string, sessionId: string, error: string): Promise<void>;
  /** Whether the chat's latest message is an edit summary (and of what), or the chat is busy answering. */
  latestEdit(orgId: string, userId: string, sessionId: string, staleBefore: Date): Promise<LatestEdit | null>;
  /**
   * In one transaction: the teacher's press and the API's own answer to it (no model involved), or the turn
   * already made for clientTurnId.
   */
  recordAnswer(
    orgId: string,
    userId: string,
    sessionId: string,
    turn: NewTurn,
    answer: ChatBlock[],
  ): Promise<TurnRecord | null>;
  /** The run for rewriting the chat's document, on its newest version; null if it isn't made yet. */
  beginRewrite(
    orgId: string,
    userId: string,
    sessionId: string,
    documentId: string,
    requests: RewriteRequest[],
  ): Promise<BegunRewrite | null>;
  /** In one transaction: the assistant's message, the turn's outcome, and the chat's title and status. */
  finishTurn(orgId: string, finished: FinishedTurn): Promise<void>;
  turn(orgId: string, userId: string, turnId: string): Promise<TurnRecord | null>;
  /**
   * An assistant message from a workflow, under the id it fixed: created once, however often it is retried.
   * Null when the chat doesn't exist (any more).
   */
  appendFromWorkflow(input: AppendChatBlocksInput): Promise<AppendChatBlocksResult | null>;
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
