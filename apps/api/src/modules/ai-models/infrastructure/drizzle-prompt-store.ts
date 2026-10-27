import { Inject, Injectable } from "@nestjs/common";
import type { LlmTask, PromptFamily, PromptVersion } from "@vidyam/contracts";
import { schema, type DatabaseHandle } from "@vidyam/db";
import { and, asc, desc, eq, ne } from "drizzle-orm";

import { DATABASE } from "../../../shared/database/tokens.js";
import type { PromptStore } from "../application/manage-prompts.js";

const { promptTemplates, users } = schema;

/** prompt_templates is global (no row-level security). */
@Injectable()
export class DrizzlePromptStore implements PromptStore {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  private query() {
    return this.database.db
      .select({ row: promptTemplates, author: users.name })
      .from(promptTemplates)
      .leftJoin(users, eq(users.id, promptTemplates.createdBy));
  }

  async versions(): Promise<PromptVersion[]> {
    const rows = await this.query().orderBy(
      asc(promptTemplates.name),
      asc(promptTemplates.modelFamily),
      desc(promptTemplates.version),
    );
    return rows.map(({ row, author }) => toVersion(row, author));
  }

  async find(id: string): Promise<PromptVersion | null> {
    const [found] = await this.query().where(eq(promptTemplates.id, id));
    return found ? toVersion(found.row, found.author) : null;
  }

  add(name: LlmTask, family: PromptFamily, body: string, authorId: string | null): Promise<PromptVersion> {
    return this.database.db.transaction(async (tx) => {
      const [latest] = await tx
        .select({ version: promptTemplates.version })
        .from(promptTemplates)
        .where(and(eq(promptTemplates.name, name), eq(promptTemplates.modelFamily, family)))
        .orderBy(desc(promptTemplates.version))
        .limit(1);
      const [row] = await tx
        .insert(promptTemplates)
        .values({ name, modelFamily: family, version: (latest?.version ?? 0) + 1, body, createdBy: authorId })
        .returning();
      return toVersion(row!, null);
    });
  }

  activate(id: string): Promise<void> {
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .update(promptTemplates)
        .set({ isActive: true })
        .where(eq(promptTemplates.id, id))
        .returning();
      await tx
        .update(promptTemplates)
        .set({ isActive: false })
        .where(
          and(
            eq(promptTemplates.name, row!.name),
            eq(promptTemplates.modelFamily, row!.modelFamily),
            ne(promptTemplates.id, id),
          ),
        );
    });
  }
}

function toVersion(row: typeof promptTemplates.$inferSelect, author: string | null): PromptVersion {
  return {
    id: row.id,
    name: row.name as LlmTask,
    modelFamily: row.modelFamily,
    version: row.version,
    body: row.body,
    isActive: row.isActive,
    source: row.createdBy ? "admin" : "package",
    createdByName: author,
    createdAt: row.createdAt.toISOString(),
  };
}
