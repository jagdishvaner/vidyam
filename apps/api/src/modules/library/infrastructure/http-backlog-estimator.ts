import { BacklogEstimates, type BacklogEstimate } from "@vidyam/contracts";

import type { Env } from "../../../config/env.js";
import type { BacklogEstimator } from "../application/content-backlogs.js";

/** The AI engine's internal API, called with the service token; a slow or absent engine reads as unreachable. */
export class HttpBacklogEstimator implements BacklogEstimator {
  constructor(private readonly env: Pick<Env, "VIDYAM_AI_INTERNAL_URL" | "VIDYAM_AI_INTERNAL_TOKEN">) {}

  async estimate(orgId: string): Promise<BacklogEstimate[] | null> {
    try {
      const url = new URL(`${this.env.VIDYAM_AI_INTERNAL_URL}/backlogs`);
      url.searchParams.set("orgId", orgId);
      const response = await fetch(url, {
        headers: { "x-vidyam-service-token": this.env.VIDYAM_AI_INTERNAL_TOKEN },
        // Counting a large library's chunks and pricing them takes a moment.
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) return null;
      return BacklogEstimates.parse(await response.json()).backlogs;
    } catch {
      return null;
    }
  }
}
