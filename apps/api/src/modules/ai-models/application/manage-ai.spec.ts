import type { AiModel } from "@vidyam/contracts";
import { describe, expect, it } from "vitest";

import { AiSettings, type AiEngine, type AiStore, type RouteValues } from "./manage-ai.js";

const ORG = "0b6f2c1e-0000-4000-8000-000000000001";
const model = (id: string, enabled = true): AiModel => ({
  id,
  provider: "anthropic",
  apiModel: id,
  displayName: id,
  contextWindow: 200_000,
  maxOutputTokens: 64_000,
  prices: { input: 5, output: 25 },
  enabled,
  teacherSelectable: false,
});
const route = (modelId: string): RouteValues => ({
  modelId,
  effort: "low",
  maxTokens: 4000,
  fallbackModelId: null,
});

function settings() {
  const saved: unknown[] = [];
  const store: AiStore = {
    models: async () => [model("opus"), model("haiku"), model("old", false)],
    updateModel: async () => true,
    routes: async () => ({
      defaults: new Map([["tag", route("haiku")]]),
      center: new Map([["generate", route("opus")]]),
    }),
    setRoute: async (_org, task, value) => {
      saved.push([task, value]);
    },
    clearRoute: async () => {},
  };
  const engine: AiEngine = { status: async () => null };
  return { ai: new AiSettings(store, engine), saved };
}

describe("AI settings", () => {
  it("lists a route for every task: the center's own, else the platform default, else none", async () => {
    const { routes, canEditModels, engine } = await settings().ai.overview(ORG, false);
    expect(routes.find((r) => r.task === "generate")).toMatchObject({ modelId: "opus", source: "center" });
    expect(routes.find((r) => r.task === "tag")).toMatchObject({ modelId: "haiku", source: "default" });
    expect(routes.find((r) => r.task === "lint")).toMatchObject({ modelId: null, source: "none" });
    expect(canEditModels).toBe(false);
    expect(engine).toBeNull();
  });

  it("leaves the shared model registry to the platform admin", async () => {
    const { ai } = settings();
    const change = { enabled: true, teacherSelectable: true };
    await expect(ai.updateModel("opus", change, false)).rejects.toMatchObject({ kind: "forbidden" });
    await expect(
      ai.updateModel("opus", { enabled: false, teacherSelectable: true }, true),
    ).rejects.toMatchObject({
      kind: "invalid",
    });
    await expect(ai.updateModel("opus", change, true)).resolves.toBeUndefined();
  });

  it("routes tasks only to enabled models, with a different fallback", async () => {
    const { ai, saved } = settings();
    const value = { modelId: "opus", effort: "high" as const, maxTokens: 32_000, fallbackModelId: "haiku" };
    await ai.setRoute(ORG, "generate", value);
    expect(saved).toEqual([["generate", value]]);
    await expect(ai.setRoute(ORG, "generate", { ...value, modelId: "old" })).rejects.toMatchObject({
      kind: "invalid",
    });
    await expect(ai.setRoute(ORG, "generate", { ...value, fallbackModelId: "opus" })).rejects.toMatchObject({
      kind: "invalid",
    });
  });
});
