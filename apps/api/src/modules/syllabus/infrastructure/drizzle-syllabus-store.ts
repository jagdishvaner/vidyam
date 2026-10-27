import { Injectable } from "@nestjs/common";
import type {
  CreateSyllabusNodeRequest,
  ExamPaper,
  ImportSummary,
  SyllabusNode,
  SyllabusOverview,
  SyllabusSubject,
  UpdateSyllabusNodeRequest,
} from "@vidyam/contracts";
import { schema, type Transaction } from "@vidyam/db";
import { asc, eq, isNull } from "drizzle-orm";

import { OrgDatabase } from "../../../shared/database/org-database.js";
import { DomainError } from "../../../shared/kernel/errors.js";
import type { ResolvedExam, SyllabusStore } from "../application/manage-syllabus.js";
import type { FlatNode, Level } from "../domain/syllabus-tree.js";

const { taxonomyNodes, exams, examSyllabus } = schema;
type NodeRow = typeof taxonomyNodes.$inferSelect;

const objectivesOf = (row: NodeRow) => {
  const objectives = row.meta.objectives;
  return Array.isArray(objectives) ? objectives.map(String) : [];
};

/**
 * The whole tree of a center is a few thousand rows at most, so paths are worked out in memory from one read
 * instead of a recursive query per request.
 */
export async function loadTree(tx: Transaction): Promise<{ rows: NodeRow[]; paths: Map<string, string> }> {
  const rows = await tx
    .select()
    .from(taxonomyNodes)
    .orderBy(asc(taxonomyNodes.sortOrder), asc(taxonomyNodes.nameEn));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const paths = new Map<string, string>();
  const pathOf = (row: NodeRow): string => {
    const known = paths.get(row.id);
    if (known) return known;
    const parent = row.parentId ? byId.get(row.parentId) : undefined;
    const path = parent ? `${pathOf(parent)}/${row.code}` : row.code;
    paths.set(row.id, path);
    return path;
  };
  rows.forEach(pathOf);
  return { rows, paths };
}

function toNode(row: NodeRow, path: string): SyllabusNode {
  return {
    id: row.id,
    parentId: row.parentId,
    code: row.code,
    path,
    level: row.level,
    nameEn: row.nameEn,
    nameHi: row.nameHi,
    aliases: row.aliases,
    objectives: objectivesOf(row),
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

/** Parents before children, siblings in their sort order. */
function readingOrder(rows: NodeRow[], rootId: string): NodeRow[] {
  const children = new Map<string | null, NodeRow[]>();
  for (const row of rows) children.set(row.parentId, [...(children.get(row.parentId) ?? []), row]);
  const ordered: NodeRow[] = [];
  const walk = (id: string) => {
    for (const child of children.get(id) ?? []) {
      ordered.push(child);
      walk(child.id);
    }
  };
  walk(rootId);
  return ordered;
}

const sameStrings = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

@Injectable()
export class DrizzleSyllabusStore implements SyllabusStore {
  constructor(private readonly orgDb: OrgDatabase) {}

  overview(orgId: string): Promise<SyllabusOverview> {
    return this.orgDb.run(orgId, async (tx) => {
      const { rows, paths } = await loadTree(tx);
      return {
        subjects: rows
          .filter((row) => row.parentId === null)
          .map((row) => ({
            ...toNode(row, paths.get(row.id)!),
            descendants: readingOrder(rows, row.id).length,
          })),
      };
    });
  }

  subject(orgId: string, subjectId: string): Promise<SyllabusSubject | null> {
    return this.orgDb.run(orgId, async (tx) => {
      const { rows, paths } = await loadTree(tx);
      const root = rows.find((row) => row.id === subjectId && row.parentId === null);
      if (!root) return null;
      return {
        subject: toNode(root, paths.get(root.id)!),
        nodes: readingOrder(rows, root.id).map((row) => toNode(row, paths.get(row.id)!)),
      };
    });
  }

  importTree(orgId: string, nodes: FlatNode[]): Promise<ImportSummary> {
    return this.orgDb.run(orgId, async (tx) => {
      const { rows, paths } = await loadTree(tx);
      const byPath = new Map(rows.map((row) => [paths.get(row.id)!, row]));
      const idOf = new Map([...byPath].map(([path, row]) => [path, row.id]));
      const summary = { created: 0, updated: 0, unchanged: 0 };
      for (const node of nodes) {
        const existing = byPath.get(node.path);
        const values = {
          level: node.level,
          nameEn: node.nameEn,
          nameHi: node.nameHi,
          aliases: node.aliases,
          sortOrder: node.sortOrder,
        };
        if (!existing) {
          const [row] = await tx
            .insert(taxonomyNodes)
            .values({
              orgId,
              parentId: node.parentPath ? idOf.get(node.parentPath)! : null,
              code: node.code,
              ...values,
              meta: { objectives: node.objectives },
            })
            .returning({ id: taxonomyNodes.id });
          idOf.set(node.path, row!.id);
          summary.created++;
          continue;
        }
        const changed =
          existing.level !== node.level ||
          existing.nameEn !== node.nameEn ||
          existing.nameHi !== node.nameHi ||
          existing.sortOrder !== node.sortOrder ||
          !sameStrings(existing.aliases, node.aliases) ||
          !sameStrings(objectivesOf(existing), node.objectives);
        if (!changed) {
          summary.unchanged++;
          continue;
        }
        await tx
          .update(taxonomyNodes)
          .set({ ...values, meta: { ...existing.meta, objectives: node.objectives }, updatedAt: new Date() })
          .where(eq(taxonomyNodes.id, existing.id));
        summary.updated++;
      }
      return summary;
    });
  }

  findNode(orgId: string, id: string): Promise<{ id: string; level: Level; path: string } | null> {
    return this.orgDb.run(orgId, async (tx) => {
      const { rows, paths } = await loadTree(tx);
      const row = rows.find((r) => r.id === id);
      return row ? { id: row.id, level: row.level, path: paths.get(row.id)! } : null;
    });
  }

  createNode(orgId: string, request: CreateSyllabusNodeRequest): Promise<SyllabusNode> {
    return this.orgDb.run(orgId, async (tx) => {
      const parent = request.parentId
        ? eq(taxonomyNodes.parentId, request.parentId)
        : isNull(taxonomyNodes.parentId);
      const siblings = await tx.select().from(taxonomyNodes).where(parent);
      if (siblings.some((s) => s.code === request.code)) {
        throw new DomainError(
          `"${request.code}" is already used here; codes must be unique among siblings.`,
          "conflict",
        );
      }
      await tx.insert(taxonomyNodes).values({
        orgId,
        parentId: request.parentId,
        code: request.code,
        level: request.level,
        nameEn: request.nameEn,
        nameHi: request.nameHi,
        aliases: request.aliases,
        sortOrder: siblings.length,
        meta: { objectives: request.objectives },
      });
      const { rows, paths } = await loadTree(tx);
      const row = rows.find((r) => r.parentId === request.parentId && r.code === request.code)!;
      return toNode(row, paths.get(row.id)!);
    });
  }

  updateNode(orgId: string, id: string, edit: UpdateSyllabusNodeRequest): Promise<SyllabusNode> {
    return this.orgDb.run(orgId, async (tx) => {
      const [current] = await tx.select().from(taxonomyNodes).where(eq(taxonomyNodes.id, id));
      await tx
        .update(taxonomyNodes)
        .set({
          nameEn: edit.nameEn,
          nameHi: edit.nameHi,
          aliases: edit.aliases,
          isActive: edit.isActive,
          meta: { ...current!.meta, objectives: edit.objectives },
          updatedAt: new Date(),
        })
        .where(eq(taxonomyNodes.id, id));
      const { rows, paths } = await loadTree(tx);
      return toNode(
        rows.find((r) => r.id === id)!,
        paths.get(id)!,
      );
    });
  }

  exams(orgId: string): Promise<ExamPaper[]> {
    return this.orgDb.run(orgId, async (tx) => {
      const { rows, paths } = await loadTree(tx);
      const nodes = new Map(rows.map((row) => [row.id, row]));
      const papers = await tx.select().from(exams).orderBy(asc(exams.family), asc(exams.nameEn));
      const links = await tx.select().from(examSyllabus);
      return papers.map((paper) => ({
        id: paper.id,
        code: paper.code,
        family: paper.family ?? paper.code,
        paperCode: paper.paperCode,
        nameEn: paper.nameEn,
        nameHi: paper.nameHi,
        authoritativeLanguage: paper.authoritativeLanguage,
        syllabus: links
          .filter((link) => link.examId === paper.id && nodes.has(link.nodeId))
          .map((link) => {
            const node = nodes.get(link.nodeId)!;
            return {
              nodeId: node.id,
              path: paths.get(node.id)!,
              nameEn: node.nameEn,
              nameHi: node.nameHi,
              weightage: link.weightage,
            };
          })
          .sort((a, b) => a.path.localeCompare(b.path)),
      }));
    });
  }

  resolvePaths(orgId: string, wanted: string[]): Promise<Map<string, string>> {
    return this.orgDb.run(orgId, async (tx) => {
      const { paths } = await loadTree(tx);
      const want = new Set(wanted);
      return new Map([...paths].filter(([, path]) => want.has(path)).map(([id, path]) => [path, id]));
    });
  }

  upsertExams(orgId: string, papers: ResolvedExam[]): Promise<ImportSummary> {
    return this.orgDb.run(orgId, async (tx) => {
      const existing = new Map((await tx.select().from(exams)).map((row) => [row.code, row]));
      const summary = { created: 0, updated: 0, unchanged: 0 };
      for (const paper of papers) {
        const values = {
          family: paper.family,
          paperCode: paper.paperCode,
          nameEn: paper.nameEn,
          nameHi: paper.nameHi,
          authoritativeLanguage: paper.authoritativeLanguage,
        };
        const before = existing.get(paper.code);
        const [row] = await tx
          .insert(exams)
          .values({ orgId, code: paper.code, ...values })
          .onConflictDoUpdate({
            target: [exams.orgId, exams.code],
            set: { ...values, updatedAt: new Date() },
          })
          .returning({ id: exams.id });
        const oldLinks = before
          ? await tx.select().from(examSyllabus).where(eq(examSyllabus.examId, before.id))
          : [];
        const sameLinks =
          oldLinks.length === paper.syllabus.length &&
          paper.syllabus.every((s) =>
            oldLinks.some((l) => l.nodeId === s.nodeId && l.weightage === s.weightage),
          );
        const sameValues =
          before &&
          before.family === values.family &&
          before.paperCode === values.paperCode &&
          before.nameEn === values.nameEn &&
          before.nameHi === values.nameHi &&
          before.authoritativeLanguage === values.authoritativeLanguage;
        if (!sameLinks) {
          await tx.delete(examSyllabus).where(eq(examSyllabus.examId, row!.id));
          await tx.insert(examSyllabus).values(
            paper.syllabus.map((s) => ({
              orgId,
              examId: row!.id,
              nodeId: s.nodeId,
              weightage: s.weightage,
            })),
          );
        }
        if (!before) summary.created++;
        else if (sameValues && sameLinks) summary.unchanged++;
        else summary.updated++;
      }
      return summary;
    });
  }

  deleteExam(orgId: string, id: string): Promise<boolean> {
    return this.orgDb.run(orgId, async (tx) => {
      const deleted = await tx.delete(exams).where(eq(exams.id, id)).returning({ id: exams.id });
      return deleted.length > 0;
    });
  }
}
