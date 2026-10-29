import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import type {
  ChatBlock,
  ChatEngineEvent,
  ChatStreamEvent,
  ChatTurnAccepted,
  ChatTurnRequest,
  DraftSpec,
} from "@vidyam/contracts";

import { DomainError } from "../../../shared/kernel/errors.js";
import { assistantMessageId, failedAnswer, TURN_TIMEOUT_MS, userBlocks } from "../domain/turns.js";
import { ManageChats } from "./manage-chats.js";
import {
  BUDGET_GATE,
  CHAT_ENGINE,
  CHAT_STORE,
  TURN_EVENTS,
  type BudgetGate,
  type ChatEngine,
  type ChatStore,
  type TurnEvents,
  type TurnRecord,
} from "./ports.js";

/** Text is sent on at most this often, in one piece, so a long answer stays a few hundred events. */
const COALESCE_MS = 50;

interface Answering {
  orgId: string;
  userId: string;
  turn: TurnRecord;
  modelId: string | null;
}

/**
 * A chat turn (ADR 0015): the teacher's message is recorded first, then answered in the background. The
 * answer goes through a Valkey stream the browser follows (FollowTurn), so a dropped connection resumes and a
 * closed tab doesn't stop it; when it ends, the answer is stored as the assistant's message.
 */
@Injectable()
export class SendTurn implements OnApplicationShutdown {
  private readonly logger = new Logger(SendTurn.name);
  private readonly answering = new Set<Promise<void>>();
  private readonly stopping = new AbortController();

  constructor(
    @Inject(CHAT_STORE) private readonly store: ChatStore,
    @Inject(BUDGET_GATE) private readonly budget: BudgetGate,
    @Inject(CHAT_ENGINE) private readonly engine: ChatEngine,
    @Inject(TURN_EVENTS) private readonly events: TurnEvents,
    private readonly chats: ManageChats,
  ) {}

  async execute(
    orgId: string,
    userId: string,
    sessionId: string,
    request: ChatTurnRequest,
  ): Promise<ChatTurnAccepted> {
    const blocks = userBlocks(request.input);
    const retried = await this.store.existingTurn(orgId, userId, sessionId, request.clientTurnId);
    if (retried) return accepted(retried);

    const modelId = request.modelId ?? null;
    await this.chats.checkModel(orgId, modelId);
    const now = new Date();
    const reason = await this.budget.exhausted(orgId, userId, now);
    if (reason) throw new DomainError(reason, "forbidden");

    const begun = await this.store.beginTurn(orgId, userId, sessionId, {
      clientTurnId: request.clientTurnId,
      blocks,
      staleBefore: new Date(now.getTime() - TURN_TIMEOUT_MS),
    });
    if (!begun) throw new DomainError("That chat doesn't exist.", "not_found");
    if (begun.kind === "busy") {
      throw new DomainError("Wait for the answer to your last message to finish.", "conflict");
    }
    if (begun.kind === "created") this.track(this.answer({ orgId, userId, turn: begun.turn, modelId }));
    return accepted(begun.turn);
  }

  /** Resolves once every answer under way has ended (tests, and shutdown). */
  async settled(): Promise<void> {
    while (this.answering.size) await Promise.allSettled([...this.answering]);
  }

  async onApplicationShutdown(): Promise<void> {
    const deadline = new Promise((resolve) => setTimeout(resolve, 10_000).unref());
    await Promise.race([this.settled(), deadline]);
    this.stopping.abort();
  }

  private track(work: Promise<void>): void {
    this.answering.add(work);
    void work.finally(() => this.answering.delete(work));
  }

  private async answer({ orgId, userId, turn, modelId }: Answering): Promise<void> {
    const messageId = assistantMessageId(turn.id);
    // Events go out one after another, in order; text is held at most COALESCE_MS and sent in one piece.
    let queue = Promise.resolve();
    const publish = (event: ChatStreamEvent): Promise<void> => {
      queue = queue.then(async () => {
        await this.events.publish(turn.id, event);
      });
      return queue;
    };
    let text = "";
    let pending = "";
    let timer: NodeJS.Timeout | null = null;
    const flush = (): Promise<void> => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (pending) void publish({ event: "text_delta", text: pending });
      pending = "";
      return queue;
    };
    const blocks: ChatBlock[] = [];
    let draftSpec: DraftSpec | null = null;
    let done: Extract<ChatEngineEvent, { event: "done" }> | null = null;
    let failure: { code: string; message: string } | null = null;

    try {
      await publish({ event: "turn_started", turnId: turn.id, messageId });
      const engineTurn = {
        orgId,
        userId,
        sessionId: turn.sessionId,
        turnId: turn.id,
        userMessageId: turn.userMessageId!,
        modelId,
      };
      try {
        for await (const event of this.engine.answer(engineTurn, this.stopping.signal)) {
          if (event.event === "text_delta") {
            text += event.text;
            pending += event.text;
            // A failed send surfaces at the next awaited flush, which ends the answer.
            timer ??= setTimeout(() => void flush().catch(() => undefined), COALESCE_MS);
            continue;
          }
          await flush();
          if (event.event === "block") {
            blocks.push(event.block);
            await publish(event);
          } else if (event.event === "draft_spec") {
            draftSpec = event.draftSpec;
            await publish(event);
          } else if (event.event === "done") {
            done = event;
          } else {
            failure = { code: event.code, message: event.message };
          }
        }
        if (!done && !failure) {
          failure = { code: "interrupted", message: "The answer stopped before it finished. Send it again." };
        }
      } catch (error) {
        this.logger.warn(`turn ${turn.id}: the AI engine failed: ${String(error)}`);
        failure = {
          code: "engine_unavailable",
          message: "The AI engine isn't answering right now. Try again in a moment.",
        };
      }
      await flush();
      await this.store.finishTurn(orgId, {
        turnId: turn.id,
        sessionId: turn.sessionId,
        assistantMessageId: messageId,
        blocks: done && !failure ? done.blocks : failedAnswer(text, blocks, failure!.code, failure!.message),
        modelId: done?.modelId ?? null,
        status: failure ? "failed" : "done",
        error: failure ? `${failure.code}: ${failure.message}` : null,
        title: done?.title ?? null,
        sessionStatus: done?.sessionStatus ?? "idle",
        draftSpec,
      });
      if (failure) await publish({ event: "error", ...failure });
      await publish({ event: "message_complete", messageId });
    } catch (error) {
      // Storing or relaying failed: the turn is marked failed when next looked at (TURN_TIMEOUT_MS).
      this.logger.error(`turn ${turn.id}: ${String(error)}`);
      await publish({
        event: "error",
        code: "not_saved",
        message: "The answer couldn't be saved. Send your message again.",
      }).catch(() => undefined);
    } finally {
      if (timer) clearTimeout(timer);
      await this.events.close(turn.id).catch(() => undefined);
    }
  }
}

function accepted(turn: TurnRecord): ChatTurnAccepted {
  return {
    turnId: turn.id,
    userMessageId: turn.userMessageId!,
    assistantMessageId: assistantMessageId(turn.id),
    status: turn.status,
  };
}
