import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import type { Problem } from "@vidyam/contracts";

import { PROBLEM_STORE, type ProblemStore } from "./list-problems.js";

/** Port: where alerts go (a chat webhook). */
export interface AlertSender {
  send(text: string): Promise<void>;
}
export const ALERT_SENDER = Symbol("ALERT_SENDER");

/** Port: shared between API instances, so each problem is sent once however many run. */
export interface AlertState {
  /** True for exactly one caller per period. */
  claim(seconds: number): Promise<boolean>;
  /** When the last alert check covered up to; null before the first. */
  checkedUntil(): Promise<Date | null>;
  setCheckedUntil(at: Date): Promise<void>;
}
export const ALERT_STATE = Symbol("ALERT_STATE");

const PERIOD_MS = 5 * 60 * 1000;
const SHOWN = 10;

const KIND_LABELS: Record<Problem["kind"], string> = {
  generation: "Making failed",
  export: "Export failed",
  chat: "Chat answer failed",
  ai_call: "AI calls failed",
  source: "File failed to read in",
};

/** The alert's text: a short list of what failed in a center, each with its error. */
export function alertText(center: string, problems: Problem[]): string {
  const lines = problems.slice(0, SHOWN).map((problem) => {
    const times = problem.count > 1 ? ` (${problem.count}×)` : "";
    const person = problem.person ? ` · ${problem.person}` : "";
    return `• ${KIND_LABELS[problem.kind]}${times}: ${problem.subject}${person}\n  ${problem.error.slice(0, 200)}`;
  });
  const more = problems.length > SHOWN ? `\n…and ${problems.length - SHOWN} more` : "";
  const noun = problems.length === 1 ? "problem" : "problems";
  return `Vidyam: ${problems.length} new ${noun} at ${center}. See Admin → System health.\n${lines.join("\n")}${more}`;
}

/**
 * Optional alerts (plan v3 step 31): every five minutes, new problems are posted to a chat webhook
 * (VIDYAM_ALERT_WEBHOOK_URL; Slack and Google Chat take `{"text": ...}`). Off unless configured; no email.
 * The first check only marks the starting point, so a restart never resends the past day.
 */
@Injectable()
export class ProblemAlerts implements OnApplicationShutdown {
  private readonly logger = new Logger(ProblemAlerts.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(PROBLEM_STORE) private readonly store: ProblemStore,
    @Inject(ALERT_STATE) private readonly state: AlertState,
    @Inject(ALERT_SENDER) private readonly sender: AlertSender | null,
  ) {}

  start(): void {
    if (!this.sender || this.timer) return;
    const tick = () =>
      void this.check().catch((error) => this.logger.warn(`alert check failed: ${String(error)}`));
    this.timer = setInterval(tick, PERIOD_MS);
    tick();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One check: returns how many problems it reported. */
  async check(now = new Date()): Promise<number> {
    if (!this.sender || !(await this.state.claim(PERIOD_MS / 1000 - 10))) return 0;
    const since = await this.state.checkedUntil();
    let reported = 0;
    if (since) {
      for (const org of await this.store.organizations()) {
        const problems = (await this.store.since(org.id, since, 50)).filter((p) => new Date(p.at) <= now);
        if (!problems.length) continue;
        await this.sender.send(alertText(org.name, problems));
        reported += problems.length;
      }
    }
    await this.state.setCheckedUntil(now);
    return reported;
  }
}
