import { Inject, Injectable } from "@nestjs/common";
import type { Problem, ProblemReport } from "@vidyam/contracts";

/** Port: what failed in an organization since a moment, newest first. */
export interface ProblemStore {
  since(orgId: string, since: Date, limit: number): Promise<Problem[]>;
  /** Every organization, for alerts that cover the whole deployment. */
  organizations(): Promise<{ id: string; name: string }[]>;
}
export const PROBLEM_STORE = Symbol("PROBLEM_STORE");

const DAY_MS = 24 * 60 * 60 * 1000;
const LIMIT = 50;

/**
 * Admin → System health's "Recent problems" (plan v3 step 31): failed papers and notes, exports, chat answers,
 * AI calls and files in the last day. Read from what the services already record; nothing new runs.
 */
@Injectable()
export class ListProblems {
  constructor(@Inject(PROBLEM_STORE) private readonly store: ProblemStore) {}

  async execute(orgId: string, now = new Date()): Promise<ProblemReport> {
    const since = new Date(now.getTime() - DAY_MS);
    return { since: since.toISOString(), items: await this.store.since(orgId, since, LIMIT) };
  }
}
