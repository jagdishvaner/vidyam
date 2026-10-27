import { Inject, Injectable } from "@nestjs/common";
import type { AiModel, LlmTask, SetTaskRouteRequest, UpdateAiModelRequest } from "@vidyam/contracts";
import { schema, type DatabaseHandle } from "@vidyam/db";
import { and, asc, eq } from "drizzle-orm";

import { OrgDatabase } from "../../../shared/database/org-database.js";
import { DATABASE } from "../../../shared/database/tokens.js";
import type { AiStore, RouteValues } from "../application/manage-ai.js";

const { llmModels, taskRoutes } = schema;
type RouteRow = typeof taskRoutes.$inferSelect;

const values = (row: RouteRow): RouteValues => ({
  modelId: row.modelId,
  effort: row.effort,
  maxTokens: row.maxTokens,
  fallbackModelId: row.fallbackModelId,
});

/** The registry is global (read outside any center); routes are per center under row-level security. */
@Injectable()
export class DrizzleAiStore implements AiStore {
  constructor(
    private readonly orgDb: OrgDatabase,
    @Inject(DATABASE) private readonly database: DatabaseHandle,
  ) {}

  async models(): Promise<AiModel[]> {
    const rows = await this.database.db
      .select()
      .from(llmModels)
      .orderBy(asc(llmModels.provider), asc(llmModels.displayName));
    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      apiModel: row.apiModel,
      displayName: row.displayName,
      contextWindow: row.contextWindow,
      maxOutputTokens: row.maxOutputTokens,
      prices: Object.fromEntries(
        Object.entries(row.prices)
          .map(([kind, price]) => [kind, Number(price)] as const)
          .filter(([, price]) => Number.isFinite(price)),
      ),
      enabled: row.enabled,
      teacherSelectable: row.teacherSelectable,
    }));
  }

  async updateModel(id: string, change: UpdateAiModelRequest): Promise<boolean> {
    const rows = await this.database.db
      .update(llmModels)
      .set({ ...change, updatedAt: new Date() })
      .where(eq(llmModels.id, id))
      .returning({ id: llmModels.id });
    return rows.length > 0;
  }

  routes(orgId: string) {
    return this.orgDb.run(orgId, async (tx) => {
      // Row-level security returns the platform defaults (org_id null) and this center's own rows.
      const rows = await tx.select().from(taskRoutes);
      return {
        defaults: new Map(rows.filter((r) => r.orgId === null).map((r) => [r.task, values(r)])),
        center: new Map(rows.filter((r) => r.orgId === orgId).map((r) => [r.task, values(r)])),
      };
    });
  }

  setRoute(orgId: string, task: LlmTask, route: SetTaskRouteRequest): Promise<void> {
    return this.orgDb.run(orgId, async (tx) => {
      await tx
        .insert(taskRoutes)
        .values({ orgId, task, ...route })
        .onConflictDoUpdate({
          target: [taskRoutes.task, taskRoutes.orgId],
          set: { ...route, updatedAt: new Date() },
        });
    });
  }

  clearRoute(orgId: string, task: LlmTask): Promise<void> {
    return this.orgDb.run(orgId, async (tx) => {
      await tx.delete(taskRoutes).where(and(eq(taskRoutes.task, task), eq(taskRoutes.orgId, orgId)));
    });
  }
}
