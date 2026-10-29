import { createHash } from "node:crypto";

import type { ChatBlock, ChatTurnInput } from "@vidyam/contracts";

import { DomainError } from "../../../shared/kernel/errors.js";

/**
 * A turn still unanswered after this long has lost its answer (the API restarted mid-turn, say). It is marked
 * failed when next looked at, so the chat can go on.
 */
export const TURN_TIMEOUT_MS = 5 * 60_000;

/** The Valkey stream a turn's events go through (ADR 0015). */
export function streamKey(turnId: string): string {
  return `vidyam:chat:turn:${turnId}`;
}

/**
 * The assistant message's id, known from the turn's before it is written: the browser is told it when the
 * turn starts, and chat messages are append-only, so no placeholder row is written first. A UUIDv8 from a hash.
 */
export function assistantMessageId(turnId: string): string {
  const hex = createHash("sha256").update(`assistant:${turnId}`).digest("hex");
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** What the teacher sent, as the blocks of their message. Cards and buttons arrive with the chat agent (step 23). */
export function userBlocks(input: ChatTurnInput): ChatBlock[] {
  if (input.kind !== "text") {
    throw new DomainError("Cards and buttons aren't answered yet; type your message instead.", "invalid");
  }
  return [{ type: "text", text: input.text }];
}

/**
 * The assistant message for an answer that failed: what had arrived, then the error, so the chat shows what
 * happened and the transcript stays readable.
 */
export function failedAnswer(text: string, blocks: ChatBlock[], code: string, message: string): ChatBlock[] {
  return [...(text ? [{ type: "text" as const, text }] : []), ...blocks, { type: "error", code, message }];
}

export function isStale(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() > TURN_TIMEOUT_MS;
}

/** ILIKE pattern for a search term, with its own % and _ taken literally. */
export function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
