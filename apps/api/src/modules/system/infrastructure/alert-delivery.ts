import type { Redis } from "ioredis";

import type { AlertSender, AlertState } from "../application/problem-alerts.js";

/** Posts `{"text": ...}`, which Slack and Google Chat incoming webhooks accept as a message. */
export class WebhookAlertSender implements AlertSender {
  constructor(private readonly url: string) {}

  async send(text: string): Promise<void> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`the alert webhook answered ${response.status}`);
  }
}

const LOCK = "alerts:lock";
const CHECKED = "alerts:checked-until";

/** In valkey-cache. Losing it to eviction only means the next check starts afresh. */
export class ValkeyAlertState implements AlertState {
  constructor(private readonly redis: Redis) {}

  async claim(seconds: number): Promise<boolean> {
    return (await this.redis.set(LOCK, "1", "EX", Math.max(1, Math.floor(seconds)), "NX")) === "OK";
  }

  async checkedUntil(): Promise<Date | null> {
    const value = await this.redis.get(CHECKED);
    return value ? new Date(value) : null;
  }

  async setCheckedUntil(at: Date): Promise<void> {
    await this.redis.set(CHECKED, at.toISOString());
  }
}
