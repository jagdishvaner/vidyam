import type { PromptVersion } from "@vidyam/contracts";
import { describe, expect, it } from "vitest";

import { PromptAdmin, type PromptStore } from "./manage-prompts.js";

function memoryStore(initial: PromptVersion[] = []) {
  const versions = [...initial];
  const store: PromptStore = {
    versions: async () => versions.map((v) => ({ ...v })),
    find: async (id) => versions.find((v) => v.id === id) ?? null,
    add: async (name, modelFamily, body, authorId) => {
      const version = {
        id: `v${versions.length + 1}`,
        name,
        modelFamily,
        version: versions.filter((v) => v.name === name && v.modelFamily === modelFamily).length + 1,
        body,
        isActive: false,
        source: authorId ? ("admin" as const) : ("package" as const),
        createdByName: null,
        createdAt: new Date(0).toISOString(),
      };
      versions.push(version);
      return version;
    },
    activate: async (id) => {
      const target = versions.find((v) => v.id === id)!;
      for (const v of versions) {
        if (v.name === target.name && v.modelFamily === target.modelFamily) v.isActive = v.id === id;
      }
    },
  };
  return { store, versions };
}

const shipped = (body: string) => [{ name: "chat_title" as const, modelFamily: "any" as const, body }];

describe("prompt versions", () => {
  it("load package prompts once, and a changed file goes live while the live one came from the package", async () => {
    const { store, versions } = memoryStore();
    const admin = new PromptAdmin(store);
    expect(await admin.syncFromPackage(shipped("first wording of the prompt"))).toEqual({
      added: 1,
      activated: 1,
    });
    expect(await admin.syncFromPackage(shipped("first wording of the prompt"))).toEqual({
      added: 0,
      activated: 0,
    });
    expect(await admin.syncFromPackage(shipped("second wording of the prompt"))).toEqual({
      added: 1,
      activated: 1,
    });
    expect(versions.filter((v) => v.isActive).map((v) => v.version)).toEqual([2]);
  });

  it("never override a version an admin made live", async () => {
    const { store, versions } = memoryStore();
    const admin = new PromptAdmin(store);
    await admin.syncFromPackage(shipped("first wording of the prompt"));
    const own = await admin.create(
      { name: "chat_title", modelFamily: "any", body: "the admin's own wording" },
      "u1",
      true,
    );
    await admin.activate(own.id, true);
    expect(await admin.syncFromPackage(shipped("second wording of the prompt"))).toEqual({
      added: 1,
      activated: 0,
    });
    expect(versions.find((v) => v.isActive)?.body).toBe("the admin's own wording");
  });

  it("leave writing and activating to the platform admin", async () => {
    const admin = new PromptAdmin(memoryStore().store);
    const request = {
      name: "chat_title" as const,
      modelFamily: "any" as const,
      body: "a prompt body that is long enough",
    };
    await expect(admin.create(request, "u1", false)).rejects.toMatchObject({ kind: "forbidden" });
    await expect(admin.activate("v1", false)).rejects.toMatchObject({ kind: "forbidden" });
    expect((await admin.overview(false)).canEdit).toBe(false);
  });
});
