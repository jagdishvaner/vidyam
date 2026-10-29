import type {
  ChatEngineEvent,
  ChatEngineTurn,
  ChatStreamEvent,
  ChatTurnRequest,
  EditDocumentInput,
  EditOp,
  GenerateDocumentInput,
} from "@vidyam/contracts";
import { describe, expect, it } from "vitest";

import { DomainError } from "../../../shared/kernel/errors.js";
import type { ManageDocuments, SaveOutcome } from "../../studio/application/manage-documents.js";
import { assistantMessageId } from "../domain/turns.js";
import { ManageChats } from "./manage-chats.js";
import type {
  BeginTurn,
  BudgetGate,
  ChatEngine,
  ChatStore,
  ConfirmSpec,
  FinishedTurn,
  GenerationStarter,
  LatestEdit,
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

function setup(
  options: {
    begin?: BeginTurn;
    budget?: string;
    engine?: ChatEngineEvent[] | Error;
    confirm?: ConfirmSpec;
    startFails?: boolean;
    edit?: SaveOutcome;
    latestEdit?: LatestEdit;
    restoreFails?: DomainError;
  } = {},
) {
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
  const started: [GenerateDocumentInput, string][] = [];
  const failedRuns: string[] = [];
  const edits: EditDocumentInput[] = [];
  const generation: GenerationStarter = {
    start: async (input, kind) => {
      if (options.startFails) throw new Error("temporal is down");
      started.push([input, kind]);
    },
    startEdit: async (input) => {
      if (options.startFails) throw new Error("temporal is down");
      edits.push(input);
    },
  };
  const recorded: unknown[][] = [];
  const order: string[] = [];
  Object.assign(store, {
    confirmSpec: async () => options.confirm ?? { kind: "nothing" },
    failRun: async (_org: string, runId: string) => {
      failedRuns.push(runId);
    },
    latestEdit: async () => options.latestEdit ?? { kind: "none" },
    recordAnswer: async (...args: unknown[]) => {
      recorded.push(args);
      return { ...TURN, status: "done" };
    },
    beginRewrite: async () => {
      order.push("rewrite run");
      return { runId: "0b6f2c1e-0000-4000-8000-0000000000c1", baseVersion: 4 };
    },
  });
  const finishTurn = store.finishTurn.bind(store);
  store.finishTurn = async (org, turn) => {
    order.push("answer stored");
    await finishTurn(org, turn);
  };
  const applied: [string, number, readonly EditOp[]][] = [];
  const restored: unknown[] = [];
  const documents = {
    editByAgent: async (_o: string, _u: string, documentId: string, base: number, ops: readonly EditOp[]) => {
      applied.push([documentId, base, ops]);
      return options.edit ?? { kind: "saved", version: base + 1 };
    },
    restore: async (_o: string, _u: string, _d: string, body: unknown) => {
      if (options.restoreFails) throw options.restoreFails;
      restored.push(body);
      return { document: { currentVersion: 6 } };
    },
  } as unknown as ManageDocuments;
  const send = new SendTurn(store, budget, engine, events, generation, new ManageChats(store), documents);
  return { send, finished, published, asked, started, failedRuns, edits, recorded, order, applied, restored };
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

  it("starts making the document when the teacher confirms a review card, and asks no model", async () => {
    const DOC = "0b6f2c1e-0000-4000-8000-0000000000d1";
    const RUN = "0b6f2c1e-0000-4000-8000-0000000000e1";
    const confirmed: ConfirmSpec = {
      kind: "confirmed",
      confirmed: {
        turn: { ...TURN, status: "done" },
        documentId: DOC,
        runId: RUN,
        kind: "worksheet",
        title: "Motion",
      },
    };
    const confirm: ChatTurnRequest = {
      clientTurnId: "browser-confirm",
      input: { kind: "action", action: "confirm_spec" },
    };
    const { send, started, published, asked } = setup({ confirm: confirmed });
    expect((await send.execute(ORG, TEACHER, CHAT, confirm)).status).toBe("done");
    expect(started).toEqual([
      [
        {
          v: 1,
          orgId: ORG,
          requestedBy: TEACHER,
          documentId: DOC,
          runId: RUN,
          sessionId: CHAT,
          modelId: null,
        },
        "worksheet",
      ],
    ]);
    expect(published.map((e) => e.event)).toEqual(["turn_started", "block", "message_complete"]);
    expect(asked).toEqual([]);

    const down = setup({ confirm: confirmed, startFails: true });
    await down.send.execute(ORG, TEACHER, CHAT, confirm);
    expect(down.failedRuns).toEqual([RUN]);
    expect(down.published.map((e) => e.event)).toEqual([
      "turn_started",
      "block",
      "error",
      "message_complete",
    ]);

    await expect(setup().send.execute(ORG, TEACHER, CHAT, confirm)).rejects.toMatchObject({
      kind: "invalid",
    });
  });

  const DOC = "0b6f2c1e-0000-4000-8000-0000000000d1";

  it("applies the edit agent's changes on the version it read, and says what happened", async () => {
    const remove: EditOp[] = [{ op: "delete_items", slotIds: ["s1-2"] }];
    const engine: ChatEngineEvent[] = [
      { event: "text_delta", text: "Removed question 2." },
      { event: "document_edit", documentId: DOC, baseVersion: 3, ops: remove, summary: "Removed question 2." },
      { event: "done", blocks: [{ type: "text", text: "Removed question 2." }], modelId: null, title: null,
        sessionStatus: "idle" },
    ]; // prettier-ignore
    const { send, finished, applied, published } = setup({ engine });
    await send.execute(ORG, TEACHER, CHAT, {
      clientTurnId: "t-edit",
      input: { kind: "text", text: "remove Q2" },
    });
    await send.settled();
    expect(applied).toEqual([[DOC, 3, remove]]);
    expect(finished[0]!.blocks).toEqual([
      { type: "text", text: "Removed question 2." },
      { type: "edit_summary", documentId: DOC, fromVersion: 3, toVersion: 4, summary: "Removed question 2.",
        ops: remove },
    ]); // prettier-ignore
    expect(published.some((e) => e.event === "block" && e.block.type === "edit_summary")).toBe(true);

    // The paper moved on meanwhile: nothing changes, and the answer says so.
    const stale = setup({ engine, edit: { kind: "conflict", current: 5 } });
    await stale.send.execute(ORG, TEACHER, CHAT, { clientTurnId: "t-2", input: { kind: "text", text: "x" } });
    await stale.send.settled();
    expect(stale.finished[0]!.blocks[1]).toMatchObject({ type: "error", code: "edit_refused" });
  });

  it("starts rewriting questions only once the answer is stored, and keeps the chat busy until it ends", async () => {
    const requests = [{ itemId: "s1-3", instruction: "harder", difficulty: 4 }];
    const engine: ChatEngineEvent[] = [
      { event: "document_rewrite", documentId: DOC, requests, summary: "Make question 3 harder." },
      { event: "done", blocks: [{ type: "text", text: "Rewriting question 3…" }], modelId: null, title: null,
        sessionStatus: "idle" },
    ]; // prettier-ignore
    const { send, finished, edits, order } = setup({ engine });
    await send.execute(ORG, TEACHER, CHAT, {
      clientTurnId: "t-re",
      input: { kind: "text", text: "Q3 harder" },
    });
    await send.settled();
    expect(order).toEqual(["answer stored", "rewrite run"]);
    expect(finished[0]!.sessionStatus).toBe("generating");
    expect(edits).toEqual([
      { v: 1, orgId: ORG, requestedBy: TEACHER, documentId: DOC, runId: "0b6f2c1e-0000-4000-8000-0000000000c1",
        sessionId: CHAT, modelId: null, baseVersion: 4, requests, summary: "Make question 3 harder." },
    ]); // prettier-ignore
  });

  it("undoes the chat's latest edit with no model, and explains when it can't", async () => {
    const latestEdit: LatestEdit = { kind: "edit", documentId: DOC, fromVersion: 3, toVersion: 5 };
    const undo: ChatTurnRequest = { clientTurnId: "t-undo", input: { kind: "action", action: "undo" } };
    const { send, recorded, restored, asked, published } = setup({ latestEdit });
    await send.execute(ORG, TEACHER, CHAT, undo);
    expect(asked).toEqual([]);
    expect(restored).toEqual([{ baseVersion: 5, version: 3 }]);
    expect(recorded[0]![4]).toEqual([
      { type: "edit_summary", documentId: DOC, fromVersion: 5, toVersion: 6,
        summary: "Undone: it is as it was at version 3.", ops: [] },
    ]); // prettier-ignore
    expect(published.map((e) => e.event)).toEqual(["turn_started", "block", "message_complete"]);

    const moved = setup({ latestEdit, restoreFails: new DomainError("moved on", "conflict") });
    await moved.send.execute(ORG, TEACHER, CHAT, undo);
    expect(moved.recorded[0]![4]).toEqual([
      expect.objectContaining({
        type: "error",
        code: "not_undone",
        message: expect.stringContaining("History"),
      }),
    ]);
    const nothing = setup({ latestEdit: { kind: "none" } });
    await nothing.send.execute(ORG, TEACHER, CHAT, undo);
    expect(nothing.recorded[0]![4]).toEqual([expect.objectContaining({ type: "text" })]);
  });
});
