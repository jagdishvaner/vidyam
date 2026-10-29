import { Injectable } from "@nestjs/common";
import type {
  SaveDocumentVersionInput,
  UpdateGenerationRunInput,
  UpdateGenerationRunResult,
} from "@vidyam/contracts";
import { schema } from "@vidyam/db";
import { and, eq, sql } from "drizzle-orm";

import { OrgDatabase } from "../../../shared/database/org-database.js";
import type { SavedVersion, StudioStore } from "../application/commit-results.js";

const { documents: d, documentVersions: v, generationRuns: r } = schema;
const FINISHED = new Set(["done", "failed", "cancelled"]);

@Injectable()
export class DrizzleStudioStore implements StudioStore {
  constructor(private readonly orgDb: OrgDatabase) {}

  saveVersion(input: SaveDocumentVersionInput): Promise<SavedVersion> {
    return this.orgDb.run(input.orgId, async (tx) => {
      // The document's row is locked, so concurrent saves take their turns.
      const [doc] = await tx
        .select({ current: d.currentVersion })
        .from(d)
        .where(eq(d.id, input.documentId))
        .for("update");
      if (!doc) return null;
      const next = input.baseVersion + 1;
      if (doc.current === next) {
        // A retry of a save that already went through has the same content.
        const [same] = await tx
          .select({ version: v.version })
          .from(v)
          .where(
            and(
              eq(v.documentId, input.documentId),
              eq(v.version, next),
              sql`${v.content} = ${JSON.stringify(input.content)}::jsonb`,
            ),
          );
        return same ? { version: next, created: false } : { conflict: doc.current };
      }
      if (doc.current !== input.baseVersion) return { conflict: doc.current };
      await tx.insert(v).values({
        orgId: input.orgId,
        documentId: input.documentId,
        version: next,
        content: input.content,
        ops: input.ops,
        authorKind: input.authorKind,
        authorId: input.authorId,
        chatMessageId: input.chatMessageId,
      });
      await tx
        .update(d)
        .set({ content: input.content, currentVersion: next })
        .where(eq(d.id, input.documentId));
      return { version: next, created: true };
    });
  }

  updateRun(input: UpdateGenerationRunInput): Promise<UpdateGenerationRunResult | null> {
    return this.orgDb.run(input.orgId, async (tx) => {
      const [run] = await tx.select({ status: r.status }).from(r).where(eq(r.id, input.runId)).for("update");
      if (!run) return null;
      const status = input.status ?? run.status;
      await tx
        .update(r)
        .set({
          status,
          ...(input.slotPlan !== undefined && { slotPlan: input.slotPlan }),
          // Slot states are merged in: each update carries only the slots that changed.
          ...(input.slotStates !== undefined && {
            slotStates: sql`${r.slotStates} || ${JSON.stringify(input.slotStates)}::jsonb`,
          }),
          ...(input.actualCostUsd !== undefined && { actualCostUsd: input.actualCostUsd.toFixed(6) }),
          ...(input.error !== undefined && { error: input.error }),
          ...(FINISHED.has(status) && !FINISHED.has(run.status) && { finishedAt: new Date() }),
        })
        .where(eq(r.id, input.runId));
      return { status };
    });
  }
}
