import { Injectable } from "@nestjs/common";
import { Blueprint, type PaperPattern } from "@vidyam/contracts";
import { schema, type Transaction } from "@vidyam/db";
import { and, desc, eq, inArray } from "drizzle-orm";

import { OrgDatabase } from "../../../shared/database/org-database.js";
import type { PatternStore, SaveOutcome } from "../application/manage-patterns.js";
import { patternTotals, sameJson } from "../domain/paper-pattern.js";
import { loadTree } from "./drizzle-syllabus-store.js";

const { exams, examBlueprints, examSyllabus } = schema;
type Row = typeof examBlueprints.$inferSelect;

function toPattern(row: Row, examCode: string): PaperPattern {
  // Stored specs passed the same contract on the way in; parsing again fills defaults added since.
  const blueprint = Blueprint.parse(row.spec);
  return {
    id: row.id,
    examId: row.examId,
    examCode,
    name: row.name,
    version: row.version,
    blueprint,
    ...patternTotals(blueprint),
  };
}

@Injectable()
export class DrizzlePatternStore implements PatternStore {
  constructor(private readonly orgDb: OrgDatabase) {}

  list(orgId: string, examId?: string): Promise<PaperPattern[]> {
    return this.orgDb.run(orgId, async (tx) => {
      const rows = await tx
        .select({ row: examBlueprints, code: exams.code })
        .from(examBlueprints)
        .innerJoin(exams, eq(exams.id, examBlueprints.examId))
        .where(and(eq(examBlueprints.isActive, true), examId ? eq(examBlueprints.examId, examId) : undefined))
        .orderBy(exams.code, examBlueprints.name);
      return rows.map(({ row, code }) => toPattern(row, code));
    });
  }

  find(orgId: string, id: string): Promise<PaperPattern | null> {
    return this.orgDb.run(orgId, async (tx) => {
      const [found] = await tx
        .select({ row: examBlueprints, code: exams.code })
        .from(examBlueprints)
        .innerJoin(exams, eq(exams.id, examBlueprints.examId))
        .where(and(eq(examBlueprints.id, id), eq(examBlueprints.isActive, true)));
      return found ? toPattern(found.row, found.code) : null;
    });
  }

  examContext(
    orgId: string,
    examId: string,
  ): Promise<{ syllabus: string[]; knownPaths: Set<string> } | null> {
    return this.orgDb.run(orgId, async (tx) => {
      const [exam] = await tx.select({ id: exams.id }).from(exams).where(eq(exams.id, examId));
      if (!exam) return null;
      const { paths } = await loadTree(tx);
      const links = await tx.select().from(examSyllabus).where(eq(examSyllabus.examId, examId));
      return {
        syllabus: links.flatMap((link) => paths.get(link.nodeId) ?? []),
        knownPaths: new Set(paths.values()),
      };
    });
  }

  examIdsByCode(orgId: string, codes: string[]): Promise<Map<string, string>> {
    return this.orgDb.run(orgId, async (tx) => {
      if (codes.length === 0) return new Map();
      const rows = await tx
        .select({ id: exams.id, code: exams.code })
        .from(exams)
        .where(inArray(exams.code, codes));
      return new Map(rows.map((r) => [r.code, r.id]));
    });
  }

  save(
    orgId: string,
    examId: string,
    name: string,
    blueprint: Blueprint,
  ): Promise<{ pattern: PaperPattern; outcome: SaveOutcome }> {
    return this.orgDb.run(orgId, async (tx) => {
      const [exam] = await tx.select({ code: exams.code }).from(exams).where(eq(exams.id, examId));
      const versions = await tx
        .select()
        .from(examBlueprints)
        .where(and(eq(examBlueprints.examId, examId), eq(examBlueprints.name, name)))
        .orderBy(desc(examBlueprints.version));
      const active = versions.find((v) => v.isActive);
      if (active && sameJson(active.spec, blueprint)) {
        return { pattern: toPattern(active, exam!.code), outcome: "unchanged" as const };
      }
      if (active) await retireRow(tx, active.id);
      const [row] = await tx
        .insert(examBlueprints)
        .values({
          orgId,
          examId,
          name,
          version: (versions[0]?.version ?? 0) + 1,
          spec: blueprint,
          isActive: true,
        })
        .returning();
      return {
        pattern: toPattern(row!, exam!.code),
        outcome: active ? ("updated" as const) : ("created" as const),
      };
    });
  }

  retire(orgId: string, id: string): Promise<boolean> {
    return this.orgDb.run(orgId, async (tx) => (await retireRow(tx, id)) > 0);
  }
}

async function retireRow(tx: Transaction, id: string): Promise<number> {
  const rows = await tx
    .update(examBlueprints)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(examBlueprints.id, id), eq(examBlueprints.isActive, true)))
    .returning({ id: examBlueprints.id });
  return rows.length;
}
