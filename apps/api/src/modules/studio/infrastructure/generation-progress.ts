import type { GenerationProgress } from "@vidyam/contracts";
import { schema, type Transaction } from "@vidyam/db";
import { desc, sql, type SQL } from "drizzle-orm";

const { generationRuns: r } = schema;

export interface LatestRun {
  progress: GenerationProgress;
  /** Slots (papers) or sections (notes) as planned, and each one's state since: for the live canvas. */
  plan: Record<string, unknown>[];
  states: Record<string, { state: string; questionId?: string | null; flags?: string[] }>;
}

/** The newest generation run matching `where` (a chat's, or a document's), with how far it has got. */
export async function latestRun(tx: Transaction, where: SQL): Promise<LatestRun | null> {
  const [run] = await tx
    .select({
      id: r.id,
      documentId: r.documentId,
      status: r.status,
      plan: r.slotPlan,
      states: r.slotStates,
      // Slots (or sections) past "pending": from the bank, written, checked, flagged or without material.
      done: sql<number>`(select count(*) from jsonb_each(${r.slotStates}) e where e.value->>'state' <> 'pending')`,
    })
    .from(r)
    .where(where)
    .orderBy(desc(r.startedAt))
    .limit(1);
  if (!run) return null;
  const plan = run.plan as Record<string, unknown>[];
  return {
    progress: {
      runId: run.id,
      documentId: run.documentId,
      status: run.status,
      done: Number(run.done),
      total: plan.length,
    },
    plan,
    states: run.states as LatestRun["states"],
  };
}
