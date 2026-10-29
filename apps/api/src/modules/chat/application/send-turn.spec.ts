import type { ChatEngineEvent, ChatEngineTurn, ChatStreamEvent, ChatTurnRequest } from "@vidyam/contracts";
import { describe, expect, it } from "vitest";

import { DomainError } from "../../../shared/kernel/errors.js";
import { assistantMessageId } from "../domain/turns.js";
import { ManageChats } from "./manage-chats.js";
import type {
  BeginTurn,
  BudgetGate,
  ChatEngine,
  ChatStore,
  FinishedTurn,
  TurnEvents,
  TurnRecord,
} from "./ports.js";
import { SendTurn } from "./send-turn.js";

const ORG = "0b6f2c1e-0000-4000-8000-000000000001";
const TEACHER = "0b6f2c1e-0000-4000-8000-000000000002";
const CHAT = "0b6f2c1e-0000-4000-8000-000000000003";
const TURN: TurnRecord = {
  id: "0b6f2c1e-0000-4000-8000-0000000000a1",
  sessionId: CHAT,
  userMessageId: "0b6f2c1e-0000-4000-8000-0000000000b1",
  assistantMessageId: null,
  status: "streaming",
  createdAt: new Date(),
};
const request: ChatTurnRequest = {
  clientTurnId: "browser-turn-1",
  input: { kind: "text", text: "What is Ohm's law?" },
};

function setup(options: { begin?: BeginTurn; budget?: string; engine?: ChatEngineEvent[] | Error } = {}) {
  const finished: FinishedTurn[] = [];
  const published: ChatStreamEvent[] = [];
  const asked: ChatEngineTurn[] = [];
  const store = {
    existingTurn: async () => null,
    beginTurn: async () => options.begin ?? { kind: "created", turn: TURN },
    finishTurn: async (_org: string, turn: FinishedTurn) => {
      finished.push(turn);
    },
    selectableModels: async () => ["claude-opus-5-5"],
    names: async () => ({ exams: {}, nodes: {}, blueprints: {} }),
  } as unknown as ChatStore;
  const budget: BudgetGate = { exhausted: async () => options.budget ?? null };
  const engine: ChatEngine = {
    async *answer(turn) {
      asked.push(turn);
      if (options.engine instanceof Error) throw options.engine;
      for (const event of options.engine ?? []) yield event;
    },
  };
  const events: TurnEvents = {
    publish: async (_turn, event) => {
      published.push(event);
      return `${published.length}-0`;
    },
    close: async () => undefined,
    reader: () => ({ next: async () => [], close: () => undefined }),
  };
  const send = new SendTurn(store, budget, engine, events, new ManageChats(store));
  return { send, finished, published, asked };
}

describe("SendTurn", () => {
  it("records the message, answers in the background and stores the answer", async () => {
    const { send, finished, published, asked } = setup({
      engine: [
        { event: "text_delta", text: "V = IR" },
        { event: "text_delta", text: ": current times resistance." },
        {
          event: "done",
          blocks: [{ type: "text", text: "V = IR: current times resistance." }],
          modelId: "claude-opus-5-5",
          title: "Doubt: Ohm's law",
          sessionStatus: "idle",
        },
      ],
    });
    const accepted = await send.execute(ORG, TEACHER, CHAT, request);
    expect(accepted).toEqual({
      turnId: TURN.id,
      userMessageId: TURN.userMessageId,
      assistantMessageId: assistantMessageId(TURN.id),
      status: "streaming",
    });
    await send.settled();

    expect(asked).toEqual([
      {
        orgId: ORG,
        userId: TEACHER,
        sessionId: CHAT,
        turnId: TURN.id,
        userMessageId: TURN.userMessageId,
        modelId: null,
      },
    ]);
    // Text that arrives together is sent on in one piece.
    expect(published).toEqual([
      { event: "turn_started", turnId: TURN.id, messageId: accepted.assistantMessageId },
      { event: "text_delta", text: "V = IR: current times resistance." },
      { event: "message_complete", messageId: accepted.assistantMessageId },
    ]);
    expect(finished).toEqual([
      expect.objectContaining({
        status: "done",
        blocks: [{ type: "text", text: "V = IR: current times resistance." }],
        modelId: "claude-opus-5-5",
        title: "Doubt: Ohm's law",
        error: null,
      }),
    ]);
  });

  it("stores what arrived and the error when the answer fails", async () => {
    const { send, finished, published } = setup({
      engine: [
        { event: "text_delta", text: "Half an answer" },
        { event: "error", code: "budget_exceeded", message: "Your monthly AI budget of US$5.00 is used up" },
      ],
    });
    await send.execute(ORG, TEACHER, CHAT, request);
    await send.settled();
    expect(finished[0]).toMatchObject({
      status: "failed",
      blocks: [
        { type: "text", text: "Half an answer" },
        { type: "error", code: "budget_exceeded", message: "Your monthly AI budget of US$5.00 is used up" },
      ],
    });
    expect(published.map((e) => e.event)).toEqual([
      "turn_started",
      "text_delta",
      "error",
      "message_complete",
    ]);
  });

  it("says so when the AI engine can't be reached, or stops mid-answer", async () => {
    const down = setup({ engine: new Error("ECONNREFUSED") });
    await down.send.execute(ORG, TEACHER, CHAT, request);
    await down.send.settled();
    expect(down.finished[0]).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/^engine_unavailable/),
    });

    const cut = setup({ engine: [{ event: "text_delta", text: "and then" }] });
    await cut.send.execute(ORG, TEACHER, CHAT, request);
    await cut.send.settled();
    expect(cut.finished[0]).toMatchObject({ status: "failed", error: expect.stringMatching(/^interrupted/) });
  });

  it("returns the turn already made for a retried request, without answering again", async () => {
    const { send, asked } = setup({ begin: { kind: "existing", turn: { ...TURN, status: "done" } } });
    expect((await send.execute(ORG, TEACHER, CHAT, request)).status).toBe("done");
    await send.settled();
    expect(asked).toEqual([]);
  });

  it("refuses a chat that is still answering, an exhausted budget, and a model the center doesn't offer", async () => {
    const busy = setup({ begin: { kind: "busy" } });
    await expect(busy.send.execute(ORG, TEACHER, CHAT, request)).rejects.toMatchObject({ kind: "conflict" });
    const broke = setup({ budget: "Your monthly AI budget of US$5.00 is used up." });
    await expect(broke.send.execute(ORG, TEACHER, CHAT, request)).rejects.toThrow(DomainError);
    const { send } = setup();
    await expect(send.execute(ORG, TEACHER, CHAT, { ...request, modelId: "gpt-0" })).rejects.toMatchObject({
      kind: "invalid",
    });
  });
});
