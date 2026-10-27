import { AiEngineStatus } from "@vidyam/contracts";

import type { Env } from "../../../config/env.js";
import type { AiEngine } from "../application/manage-ai.js";

/** The AI engine's internal API, called with the service token; a slow or absent engine reads as unknown. */
export class HttpAiEngine implements AiEngine {
  constructor(private readonly env: Pick<Env, "VIDYAM_AI_INTERNAL_URL" | "VIDYAM_AI_INTERNAL_TOKEN">) {}

  async status(): Promise<AiEngineStatus | null> {
    try {
      const response = await fetch(`${this.env.VIDYAM_AI_INTERNAL_URL}/providers`, {
        headers: { "x-vidyam-service-token": this.env.VIDYAM_AI_INTERNAL_TOKEN },
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return null;
      return AiEngineStatus.parse(await response.json());
    } catch {
      return null;
    }
  }
}
