import type { Problem } from "@vidyam/contracts";
import { describe, expect, it } from "vitest";

import type { ProblemStore } from "./list-problems.js";
import { alertText, ProblemAlerts, type AlertState } from "./problem-alerts.js";

const problem = (over: Partial<Problem> = {}): Problem => ({
  kind: "export",
  id: crypto.randomUUID(),
  at: "2026-10-30T10:00:00.000Z",
  subject: "Force test (pdf, paper)",
  person: "Meena",
  error: "Chromium crashed",
  count: 1,
  ...over,
});

function memoryState(checkedUntil: Date | null = null): AlertState & { at: Date | null; locked: boolean } {
  return {
    at: checkedUntil,
    locked: false,
    async claim() {
      if (this.locked) return false;
      this.locked = true;
      return true;
    },
    async checkedUntil() {
      return this.at;
    },
    async setCheckedUntil(at) {
      this.at = at;
    },
  };
}

function store(problems: Problem[]): ProblemStore & { asked: Date[] } {
  return {
    asked: [],
    async since(_orgId, since) {
      this.asked.push(since);
      return problems.filter((p) => new Date(p.at) > since);
    },
    async organizations() {
      return [{ id: "org", name: "Jaipur Center" }];
    },
  };
}

describe("alertText", () => {
  it("names the center, then each problem with its count, person and error", () => {
    const text = alertText("Jaipur Center", [
      problem(),
      problem({
        kind: "ai_call",
        subject: "generate · claude-opus-5-5",
        person: null,
        count: 4,
        error: "429",
      }),
    ]);
    expect(text).toBe(
      "Vidyam: 2 new problems at Jaipur Center. See Admin → System health.\n" +
        "• Export failed: Force test (pdf, paper) · Meena\n  Chromium crashed\n" +
        "• AI calls failed (4×): generate · claude-opus-5-5\n  429",
    );
  });

  it("shows ten and counts the rest", () => {
    const text = alertText(
      "C",
      Array.from({ length: 12 }, () => problem()),
    );
    expect(text.match(/^• /gm)).toHaveLength(10);
    expect(text).toMatch(/…and 2 more$/);
  });
});

describe("ProblemAlerts", () => {
  const now = new Date("2026-10-30T12:00:00.000Z");

  it("only marks where it starts on the first check, so the past day isn't resent", async () => {
    const sent: string[] = [];
    const state = memoryState();
    const alerts = new ProblemAlerts(store([problem()]), state, {
      send: async (text) => void sent.push(text),
    });
    expect(await alerts.check(now)).toBe(0);
    expect(sent).toEqual([]);
    expect(state.at).toEqual(now);
  });

  it("sends the problems since the last check, once", async () => {
    const sent: string[] = [];
    const state = memoryState(new Date("2026-10-30T09:00:00.000Z"));
    const problems = store([problem(), problem({ at: "2026-10-30T08:00:00.000Z" })]);
    const alerts = new ProblemAlerts(problems, state, { send: async (text) => void sent.push(text) });
    expect(await alerts.check(now)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("1 new problem at Jaipur Center");
    expect(state.at).toEqual(now);
    // Another instance in the same period finds the claim taken.
    expect(await alerts.check(now)).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("does nothing without a webhook", async () => {
    const problems = store([problem()]);
    const alerts = new ProblemAlerts(problems, memoryState(new Date(0)), null);
    expect(await alerts.check(now)).toBe(0);
    expect(problems.asked).toEqual([]);
  });
});
