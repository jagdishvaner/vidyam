import { describe, expect, it } from "vitest";

import { FollowTurn, type FollowItem } from "./follow-turn.js";
import type { ChatStore, StoredEvent, TurnEvents, TurnRecord } from "./ports.js";

const ORG = "0b6f2c1e-0000-4000-8000-000000000001";
const TEACHER = "0b6f2c1e-0000-4000-8000-000000000002";
const TURN_ID = "0b6f2c1e-0000-4000-8000-0000000000a1";
const ANSWER = "0b6f2c1e-0000-4000-8000-0000000000c1";

const STREAM: StoredEvent[] = [
  { id: "1-0", event: { event: "turn_started", turnId: TURN_ID, messageId: ANSWER } },
  { id: "2-0", event: { event: "text_delta", text: "V = IR" } },
  { id: "3-0", event: { event: "message_complete", messageId: ANSWER } },
];

function setup(turn: Partial<TurnRecord> | null, stream: StoredEvent[] = STREAM) {
  const failed: string[] = [];
  const record: TurnRecord | null = turn && {
    id: TURN_ID,
    sessionId: "s",
    userMessageId: "u",
    assistantMessageId: null,
    status: "streaming",
    createdAt: new Date(),
    ...turn,
  };
  const store = {
    turn: async () => record,
    failTurn: async (_org: string, id: string) => {
      failed.push(id);
    },
  } as unknown as ChatStore;
  const events: TurnEvents = {
    publish: async () => "",
    close: async () => undefined,
    reader: () => ({
      next: async (_turn, after) => stream.filter((e) => after === null || e.id > after),
      close: () => undefined,
    }),
  };
  return { follow: new FollowTurn(store, events), failed };
}

async function collect(stream: AsyncGenerator<FollowItem>, limit = 10): Promise<FollowItem[]> {
  const items: FollowItem[] = [];
  for await (const item of stream) {
    items.push(item);
    if (items.length >= limit) break;
  }
  return items;
}

describe("FollowTurn", () => {
  it("replays the answer, or continues after the last event the browser saw", async () => {
    const { follow } = setup({});
    const all = await collect(follow.follow(ORG, TEACHER, TURN_ID, null, new AbortController().signal));
    expect(all).toEqual(STREAM);
    const rest = await collect(follow.follow(ORG, TEACHER, TURN_ID, "1-0", new AbortController().signal));
    expect(rest.map((item) => ("id" in item ? item.id : "beat"))).toEqual(["2-0", "3-0"]);
  });

  it("reports a turn whose stream has expired as complete, and a lost answer as interrupted", async () => {
    const stored = setup({ status: "done", assistantMessageId: ANSWER }, []);
    expect(
      await collect(stored.follow.follow(ORG, TEACHER, TURN_ID, null, new AbortController().signal)),
    ).toEqual([{ id: "stored", event: { event: "message_complete", messageId: ANSWER } }]);

    const lost = setup({ createdAt: new Date(Date.now() - 6 * 60_000) }, []);
    const items = await collect(
      lost.follow.follow(ORG, TEACHER, TURN_ID, null, new AbortController().signal),
    );
    expect(items).toEqual([
      { id: "stored", event: expect.objectContaining({ event: "error", code: "interrupted" }) },
    ]);
    expect(lost.failed).toEqual([TURN_ID]);
  });

  it("keeps a quiet connection alive while the answer is still coming", async () => {
    const { follow } = setup({}, []);
    expect(
      await collect(follow.follow(ORG, TEACHER, TURN_ID, null, new AbortController().signal), 2),
    ).toEqual([{ heartbeat: true }, { heartbeat: true }]);
  });

  it("only opens a teacher's own turn", async () => {
    await expect(setup(null).follow.open(ORG, TEACHER, TURN_ID)).rejects.toMatchObject({ kind: "not_found" });
  });
});
