import { ChatStreamEvent } from "@vidyam/contracts";
import type { Redis } from "ioredis";

import type { StoredEvent, TurnEventReader, TurnEvents } from "../application/ports.js";
import { streamKey } from "../domain/turns.js";

/** While a turn is answered its stream lives this long; after it ends, long enough to reconnect and catch up. */
const LIVE_TTL_S = 60 * 60;
const ENDED_TTL_S = 15 * 60;
/** A safety cap: text is sent in pieces of ~50 ms, so an answer is a few hundred entries. */
const MAX_ENTRIES = 20_000;

type Entries = [id: string, fields: string[]][];

/**
 * A turn's events in a Valkey stream (ADR 0015). Entry ids are the SSE event ids, so a browser that reconnects
 * with Last-Event-ID continues from the next one. Each reader blocks on its own connection.
 */
export class ValkeyTurnEvents implements TurnEvents {
  constructor(private readonly redis: Redis) {}

  async publish(turnId: string, event: ChatStreamEvent): Promise<string> {
    const key = streamKey(turnId);
    const [[, id]] = (await this.redis
      .multi()
      .xadd(key, "MAXLEN", "~", MAX_ENTRIES, "*", "e", JSON.stringify(event))
      .expire(key, LIVE_TTL_S)
      .exec()) as [[Error | null, string]];
    return id;
  }

  async close(turnId: string): Promise<void> {
    await this.redis.expire(streamKey(turnId), ENDED_TTL_S);
  }

  reader(): TurnEventReader {
    const connection = this.redis.duplicate();
    return {
      async next(turnId, after, waitMs): Promise<StoredEvent[]> {
        const key = streamKey(turnId);
        const from = after ?? "0-0";
        const reply = (
          waitMs > 0
            ? await connection.xread("COUNT", 500, "BLOCK", waitMs, "STREAMS", key, from)
            : await connection.xread("COUNT", 500, "STREAMS", key, from)
        ) as [string, Entries][] | null;
        return (reply?.[0]?.[1] ?? []).map(([id, fields]) => ({
          id,
          event: ChatStreamEvent.parse(JSON.parse(fields[1]!)),
        }));
      },
      close() {
        connection.disconnect();
      },
    };
  }
}
