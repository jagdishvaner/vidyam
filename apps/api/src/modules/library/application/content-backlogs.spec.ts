import type { BacklogEstimate, BacklogRun, RunBacklogInput } from "@vidyam/contracts";
import { describe, expect, it } from "vitest";

import { ContentBacklogs, type BacklogEstimator, type BacklogRunner } from "./content-backlogs.js";

const ORG = "0b6f2c1e-0000-4000-8000-000000000001";
const estimate = (
  kind: BacklogEstimate["kind"],
  items: number,
  blocked: string | null = null,
): BacklogEstimate => ({
  kind,
  items,
  requests: items,
  modelId: "claude-haiku-5-5",
  provider: "anthropic",
  costUsd: items * 0.01,
  blocked,
});

function setup(estimates: BacklogEstimate[] | null, running = false) {
  const started: RunBacklogInput[] = [];
  const estimator: BacklogEstimator = { estimate: async () => estimates };
  const runner: BacklogRunner = {
    runs: async () => [],
    start: async (input) => {
      started.push(input);
      if (running) return null;
      return {
        kind: input.kind,
        workflowId: "w",
        status: "running",
        startedAt: "2026-10-28T10:00:00Z",
      } as BacklogRun;
    },
  };
  return { useCase: new ContentBacklogs(estimator, runner), started };
}

describe("ContentBacklogs", () => {
  it("shows the estimates, or says the AI engine can't be reached", async () => {
    const reachable = setup([estimate("ocr", 3)]);
    expect(await reachable.useCase.overview(ORG)).toEqual({
      backlogs: [estimate("ocr", 3)],
      runs: [],
      reachable: true,
    });
    expect(await setup(null).useCase.overview(ORG)).toEqual({ backlogs: [], runs: [], reachable: false });
  });

  it("starts a run with the person who asked for it", async () => {
    const { useCase, started } = setup([estimate("segment", 2)]);
    await expect(useCase.run(ORG, "u1", "segment", 10)).resolves.toMatchObject({ status: "running" });
    expect(started).toEqual([{ v: 1, orgId: ORG, requestedBy: "u1", kind: "segment", limit: 10 }]);
  });

  it("refuses a run with nothing waiting, one that is blocked, and a second one at once", async () => {
    await expect(setup([estimate("tag", 0)]).useCase.run(ORG, null, "tag", null)).rejects.toThrow(
      /Nothing is waiting/,
    );
    await expect(
      setup([estimate("ocr", 5, "The center's monthly AI budget of US$10.00 is used up")]).useCase.run(
        ORG,
        null,
        "ocr",
        null,
      ),
    ).rejects.toThrow(/budget/);
    await expect(setup([estimate("ocr", 5)], true).useCase.run(ORG, null, "ocr", null)).rejects.toThrow(
      /already running/,
    );
    await expect(setup(null).useCase.run(ORG, null, "ocr", null)).rejects.toThrow(/can't be reached/);
  });
});
