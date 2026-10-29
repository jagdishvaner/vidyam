import { Inject, Injectable } from "@nestjs/common";

import { DomainError } from "../../../shared/kernel/errors.js";
import { isStale } from "../domain/turns.js";
import { CHAT_STORE, TURN_EVENTS, type ChatStore, type StoredEvent, type TurnEvents } from "./ports.js";

/** How long a connection waits for the next event before checking on the turn (and sending a keep-alive). */
export const WAIT_MS = 15_000;

export type FollowItem = StoredEvent | { heartbeat: true };

const FINISHED = new Set(["done", "failed", "cancelled"]);

/**
 * A browser following a turn's answer (ADR 0015). Events come from the turn's Valkey stream, after the last
 * one the browser saw (`Last-Event-ID`), until the answer is complete. A turn whose stream has expired is
 * reported complete, so the browser reloads the chat; one that lost its answer is reported interrupted.
 */
@Injectable()
export class FollowTurn {
  constructor(
    @Inject(CHAT_STORE) private readonly store: ChatStore,
    @Inject(TURN_EVENTS) private readonly events: TurnEvents,
  ) {}

  /** Checks the turn is the teacher's own, before any event is sent. */
  async open(orgId: string, userId: string, turnId: string): Promise<void> {
    if (!(await this.store.turn(orgId, userId, turnId))) {
      throw new DomainError("That message doesn't exist.", "not_found");
    }
  }

  async *follow(
    orgId: string,
    userId: string,
    turnId: string,
    lastEventId: string | null,
    signal: AbortSignal,
  ): AsyncGenerator<FollowItem> {
    const reader = this.events.reader();
    // A closed connection stops the wait at once (the blocked read fails, and the loop ends).
    signal.addEventListener("abort", () => reader.close(), { once: true });
    let after = lastEventId;
    let wait = 0; // the first look doesn't wait: a finished turn is answered at once
    try {
      while (!signal.aborted) {
        let batch: StoredEvent[];
        try {
          batch = await reader.next(turnId, after, wait);
        } catch (error) {
          if (signal.aborted) return;
          throw error;
        }
        wait = WAIT_MS;
        for (const item of batch) {
          yield item;
          after = item.id;
          if (item.event.event === "message_complete") return;
        }
        if (batch.length) continue;

        const turn = await this.store.turn(orgId, userId, turnId);
        if (!turn) return;
        if (FINISHED.has(turn.status)) {
          if (turn.assistantMessageId) {
            yield { id: "stored", event: { event: "message_complete", messageId: turn.assistantMessageId } };
          } else {
            yield { id: "stored", event: lost() };
          }
          return;
        }
        if (isStale(turn.createdAt, new Date())) {
          await this.store.failTurn(orgId, turnId, "interrupted: the answer was lost");
          yield { id: "stored", event: lost() };
          return;
        }
        yield { heartbeat: true };
      }
    } finally {
      reader.close();
    }
  }
}

function lost() {
  return {
    event: "error" as const,
    code: "interrupted",
    message: "The answer to this message was lost. Send it again.",
  };
}
