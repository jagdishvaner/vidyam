import { Inject, Injectable } from "@nestjs/common";
import type {
  BacklogEstimate,
  BacklogKind,
  BacklogOverview,
  BacklogRun,
  RunBacklogInput,
} from "@vidyam/contracts";

import { DomainError } from "../../../shared/kernel/errors.js";

/** Port: the AI engine's estimates of a center's backlogs (its internal API); null when it can't be reached. */
export interface BacklogEstimator {
  estimate(orgId: string): Promise<BacklogEstimate[] | null>;
}
export const BACKLOG_ESTIMATOR = Symbol("BACKLOG_ESTIMATOR");

/** Port: backlog runs (the RunBacklog workflow, at most one per center and kind at a time). */
export interface BacklogRunner {
  runs(orgId: string): Promise<BacklogRun[]>;
  /** null when a run of that kind is already going on. */
  start(input: RunBacklogInput): Promise<BacklogRun | null>;
}
export const BACKLOG_RUNNER = Symbol("BACKLOG_RUNNER");

/**
 * Admin → Content (plan v3 §2, §8): what is waiting for OCR, question splitting and topics, what running each
 * would cost, and starting a run. Nothing paid starts by itself: a run is refused unless its estimate is
 * current and nothing blocks it.
 */
@Injectable()
export class ContentBacklogs {
  constructor(
    @Inject(BACKLOG_ESTIMATOR) private readonly estimator: BacklogEstimator,
    @Inject(BACKLOG_RUNNER) private readonly runner: BacklogRunner,
  ) {}

  async overview(orgId: string): Promise<BacklogOverview> {
    const [backlogs, runs] = await Promise.all([this.estimator.estimate(orgId), this.runner.runs(orgId)]);
    return { backlogs: backlogs ?? [], runs, reachable: backlogs !== null };
  }

  async run(
    orgId: string,
    requestedBy: string | null,
    kind: BacklogKind,
    limit: number | null,
  ): Promise<BacklogRun> {
    const estimates = await this.estimator.estimate(orgId);
    if (!estimates) throw new DomainError("The AI engine can't be reached; try again shortly.", "conflict");
    const estimate = estimates.find((e) => e.kind === kind);
    if (!estimate || estimate.items === 0)
      throw new DomainError("Nothing is waiting in this backlog.", "conflict");
    if (estimate.blocked) throw new DomainError(estimate.blocked, "conflict");
    const started = await this.runner.start({ v: 1, orgId, requestedBy, kind, limit });
    if (!started) throw new DomainError("This backlog is already running.", "conflict");
    return started;
  }
}
