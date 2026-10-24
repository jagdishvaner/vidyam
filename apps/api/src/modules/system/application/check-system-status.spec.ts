import type { ServiceHealth } from "@vidyam/contracts";
import { describe, expect, it } from "vitest";

import { CheckSystemStatus, type AiEngineHealthReader, type DependencyProbe } from "./check-system-status.js";

const probe = (name: string, behaviour: () => Promise<string | null>): DependencyProbe => ({
  name,
  check: behaviour,
});

const healthyAi: AiEngineHealthReader = {
  read: async (): Promise<ServiceHealth> => ({ service: "ai", version: "0.1.0", ok: true, dependencies: [] }),
};

describe("CheckSystemStatus", () => {
  it("is ok only when every API dependency and the AI engine are ok", async () => {
    const status = await new CheckSystemStatus(
      [probe("postgres", async () => "connected")],
      healthyAi,
    ).execute();
    expect(status.ok).toBe(true);
    expect(status.services.map((s) => [s.service, s.ok])).toEqual([
      ["api", true],
      ["ai", true],
    ]);
  });

  it("reports a failing dependency with its error instead of throwing", async () => {
    const status = await new CheckSystemStatus(
      [
        probe("postgres", async () => "connected"),
        probe("s3", async () => {
          throw new Error("bucket missing");
        }),
      ],
      healthyAi,
    ).execute();
    expect(status.ok).toBe(false);
    expect(status.services[0]?.dependencies.find((d) => d.name === "s3")).toMatchObject({
      ok: false,
      detail: "bucket missing",
    });
  });

  it("marks the AI engine down when it can't be reached", async () => {
    const unreachable: AiEngineHealthReader = {
      read: async () => {
        throw new Error("fetch failed");
      },
    };
    const status = await new CheckSystemStatus([], unreachable).execute();
    expect(status.services[1]).toMatchObject({ service: "ai", ok: false });
  });
});
