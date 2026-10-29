import { ChatEngineEvent, type ChatEngineTurn } from "@vidyam/contracts";

import type { Env } from "../../../config/env.js";
import type { ChatEngine } from "../application/ports.js";

/** An answer that goes quiet this long is given up on. */
const IDLE_MS = 120_000;

/**
 * The AI engine's chat endpoint (ADR 0015): ids in, ChatEngineEvent lines (NDJSON) out, each checked against
 * the contract. Internal, with the service token.
 */
export class HttpChatEngine implements ChatEngine {
  constructor(
    private readonly env: Pick<Env, "VIDYAM_AI_INTERNAL_URL" | "VIDYAM_AI_INTERNAL_TOKEN">,
    private readonly idleMs = IDLE_MS,
  ) {}

  async *answer(turn: ChatEngineTurn, signal: AbortSignal): AsyncGenerator<ChatEngineEvent> {
    const quiet = new AbortController();
    let timer = setTimeout(() => quiet.abort(), this.idleMs);
    const heard = () => {
      clearTimeout(timer);
      timer = setTimeout(() => quiet.abort(), this.idleMs);
    };
    try {
      const response = await fetch(`${this.env.VIDYAM_AI_INTERNAL_URL}/chat/turns`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vidyam-service-token": this.env.VIDYAM_AI_INTERNAL_TOKEN,
        },
        body: JSON.stringify(turn),
        signal: AbortSignal.any([signal, quiet.signal]),
      });
      if (!response.ok || !response.body) throw new Error(`AI engine: HTTP ${response.status}`);
      let buffer = "";
      for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
        heard();
        buffer += chunk;
        let end: number;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end).trim();
          buffer = buffer.slice(end + 1);
          if (line) yield ChatEngineEvent.parse(JSON.parse(line));
        }
      }
      if (buffer.trim()) yield ChatEngineEvent.parse(JSON.parse(buffer));
    } finally {
      clearTimeout(timer);
    }
  }
}
