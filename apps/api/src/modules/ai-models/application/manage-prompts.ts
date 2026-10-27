import { Inject, Injectable } from "@nestjs/common";
import type {
  CreatePromptVersionRequest,
  LlmTask,
  PromptFamily,
  PromptsOverview,
  PromptVersion,
} from "@vidyam/contracts";

import { DomainError } from "../../../shared/kernel/errors.js";

/** Port: prompt versions (global, shared by every center). A version with no author came from packages/prompts. */
export interface PromptStore {
  versions(): Promise<PromptVersion[]>;
  find(id: string): Promise<PromptVersion | null>;
  /** Adds the next version number for this task and family, inactive. */
  add(name: LlmTask, family: PromptFamily, body: string, authorId: string | null): Promise<PromptVersion>;
  /** Makes this the live version of its task and family; the previous one stops being live. */
  activate(id: string): Promise<void>;
}
export const PROMPT_STORE = Symbol("PROMPT_STORE");

export interface PackagePrompt {
  name: LlmTask;
  modelFamily: PromptFamily;
  body: string;
}

@Injectable()
export class PromptAdmin {
  constructor(@Inject(PROMPT_STORE) private readonly store: PromptStore) {}

  async overview(isPlatformAdmin: boolean): Promise<PromptsOverview> {
    return { versions: await this.store.versions(), canEdit: isPlatformAdmin };
  }

  async create(
    request: CreatePromptVersionRequest,
    authorId: string,
    isPlatformAdmin: boolean,
  ): Promise<PromptVersion> {
    this.mustEdit(isPlatformAdmin);
    return this.store.add(request.name, request.modelFamily, request.body, authorId);
  }

  async activate(id: string, isPlatformAdmin: boolean): Promise<void> {
    this.mustEdit(isPlatformAdmin);
    if (!(await this.store.find(id))) throw new DomainError("No such prompt version.", "not_found");
    await this.store.activate(id);
  }

  /**
   * Loads the prompts shipped in packages/prompts. A changed file becomes a new version, and goes live by itself
   * only while the live version also came from the package: an admin's own choice is never overridden.
   */
  async syncFromPackage(prompts: PackagePrompt[]): Promise<{ added: number; activated: number }> {
    const existing = await this.store.versions();
    let added = 0;
    let activated = 0;
    for (const prompt of prompts) {
      const mine = existing.filter((v) => v.name === prompt.name && v.modelFamily === prompt.modelFamily);
      const latestFromPackage = mine
        .filter((v) => v.source === "package")
        .sort((a, b) => b.version - a.version)[0];
      if (latestFromPackage?.body === prompt.body) continue;
      const version = await this.store.add(prompt.name, prompt.modelFamily, prompt.body, null);
      added++;
      const live = mine.find((v) => v.isActive);
      if (!live || live.source === "package") {
        await this.store.activate(version.id);
        activated++;
      }
    }
    return { added, activated };
  }

  private mustEdit(isPlatformAdmin: boolean) {
    if (!isPlatformAdmin)
      throw new DomainError(
        "Prompts are shared by every center; only the platform admin edits them.",
        "forbidden",
      );
  }
}
