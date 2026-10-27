import { Inject, Injectable } from "@nestjs/common";
import {
  LlmTask,
  type AiEngineStatus,
  type AiModel,
  type AiOverview,
  type SetTaskRouteRequest,
  type TaskRoute,
  type UpdateAiModelRequest,
} from "@vidyam/contracts";

import { DomainError } from "../../../shared/kernel/errors.js";

/** Port: the global model registry and each center's task routes. */
export interface AiStore {
  models(): Promise<AiModel[]>;
  updateModel(id: string, change: UpdateAiModelRequest): Promise<boolean>;
  /** The platform default and the center's own route for every task that has one. */
  routes(orgId: string): Promise<{ defaults: Map<string, RouteValues>; center: Map<string, RouteValues> }>;
  setRoute(orgId: string, task: LlmTask, route: SetTaskRouteRequest): Promise<void>;
  clearRoute(orgId: string, task: LlmTask): Promise<void>;
}
export const AI_STORE = Symbol("AI_STORE");

export type RouteValues = Omit<TaskRoute, "task" | "source">;

/** Port: the AI engine, which alone holds provider keys. */
export interface AiEngine {
  /** Null when the engine can't be reached. */
  status(): Promise<AiEngineStatus | null>;
}
export const AI_ENGINE = Symbol("AI_ENGINE");

@Injectable()
export class AiSettings {
  constructor(
    @Inject(AI_STORE) private readonly store: AiStore,
    @Inject(AI_ENGINE) private readonly engine: AiEngine,
  ) {}

  async overview(orgId: string, isPlatformAdmin: boolean): Promise<AiOverview> {
    const [models, { defaults, center }, engine] = await Promise.all([
      this.store.models(),
      this.store.routes(orgId),
      this.engine.status(),
    ]);
    const routes: TaskRoute[] = LlmTask.options.map((task) => {
      const own = center.get(task);
      const fallback = defaults.get(task);
      if (own) return { task, ...own, source: "center" };
      if (fallback) return { task, ...fallback, source: "default" };
      return { task, modelId: null, effort: null, maxTokens: null, fallbackModelId: null, source: "none" };
    });
    return { models, routes, engine, canEditModels: isPlatformAdmin };
  }

  /** The registry is shared by every center, so only the platform admin changes it. */
  async updateModel(id: string, change: UpdateAiModelRequest, isPlatformAdmin: boolean): Promise<void> {
    if (!isPlatformAdmin)
      throw new DomainError("Only the platform admin can change the model registry.", "forbidden");
    if (change.teacherSelectable && !change.enabled) {
      throw new DomainError("A model teachers can pick must be enabled.", "invalid");
    }
    if (!(await this.store.updateModel(id, change))) throw new DomainError("No such model.", "not_found");
  }

  async setRoute(orgId: string, task: LlmTask, route: SetTaskRouteRequest): Promise<void> {
    const enabled = new Set((await this.store.models()).filter((m) => m.enabled).map((m) => m.id));
    for (const id of [route.modelId, route.fallbackModelId]) {
      if (id && !enabled.has(id)) throw new DomainError(`${id} isn't an enabled model.`, "invalid");
    }
    if (route.fallbackModelId === route.modelId) {
      throw new DomainError("The fallback must be a different model.", "invalid");
    }
    await this.store.setRoute(orgId, task, route);
  }

  /** Back to the platform default for this task. */
  clearRoute(orgId: string, task: LlmTask): Promise<void> {
    return this.store.clearRoute(orgId, task);
  }
}
