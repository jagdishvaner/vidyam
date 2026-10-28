import { Inject, Injectable } from "@nestjs/common";
import type { MemberSettings, MySettings } from "@vidyam/contracts";

import { DomainError } from "../../../shared/kernel/errors.js";

/** Port: a member's own defaults in one center, and the choices the center allows them. */
export interface MySettingsStore {
  load(orgId: string, userId: string): Promise<MySettings>;
  save(orgId: string, userId: string, settings: MemberSettings): Promise<void>;
  rename(userId: string, name: string): Promise<void>;
}
export const MY_SETTINGS_STORE = Symbol("MY_SETTINGS_STORE");

@Injectable()
export class MySettingsService {
  constructor(@Inject(MY_SETTINGS_STORE) private readonly store: MySettingsStore) {}

  get(orgId: string, userId: string): Promise<MySettings> {
    return this.store.load(orgId, userId);
  }

  /** The default model must be one the center lets teachers pick, and the exam one of the center's papers. */
  async update(orgId: string, userId: string, settings: MemberSettings): Promise<void> {
    const { models, exams } = await this.store.load(orgId, userId);
    if (settings.defaultModelId && !models.some((m) => m.id === settings.defaultModelId)) {
      throw new DomainError("Your center doesn't offer that model.", "invalid");
    }
    if (settings.defaultExamId && !exams.some((e) => e.id === settings.defaultExamId)) {
      throw new DomainError("That isn't one of your center's exam papers.", "invalid");
    }
    await this.store.save(orgId, userId, settings);
  }

  rename(userId: string, name: string): Promise<void> {
    return this.store.rename(userId, name);
  }
}
