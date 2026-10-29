import { Injectable } from "@nestjs/common";
import type {
  CanvasQuestion,
  CitationRef,
  DocumentContent,
  DocumentDetail,
  DocumentVersion,
  DocumentVersionSummary,
  EditOp,
  LocalizedText,
  NotesDocument,
  PaperDocument,
  PaperSection,
  SlotState,
  TaskKind,
  TaskSpec,
} from "@vidyam/contracts";
import { schema, type Transaction } from "@vidyam/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { OrgDatabase } from "../../../shared/database/org-database.js";
import { DomainError } from "../../../shared/kernel/errors.js";
import type { DocumentStore, SaveOutcome } from "../application/manage-documents.js";
import { isPaper, questionIds, type ResolvedOp } from "../domain/edits.js";
import { latestRun, type LatestRun } from "./generation-progress.js";

const {
  documents: d,
  documentVersions: v,
  generationRuns: r,
  questions: q,
  questionTags: qt,
  chunks: c,
  sources: src,
  pages: p,
  taxonomyNodes: n,
  users,
} = schema;
const MAKING = ["planning", "running"];
const SOURCES_PER_QUESTION = 3;

type DocumentRow = typeof d.$inferSelect;

/** While the first version is being made, the canvas shows the run's slots (or sections) as they stand. */
function live(doc: DocumentRow, run: LatestRun): DocumentContent {
  const spec = doc.spec as TaskSpec;
  if ("sections" in spec) {
    const slots = run.plan.map((slot) => {
      const now = run.states[String(slot.slotId)];
      return {
        ...slot,
        ...(now && { state: now.state, questionId: now.questionId ?? null, flags: now.flags ?? [] }),
      };
    }) as unknown as PaperDocument["slots"];
    const sections = spec.sections.map((section: PaperSection, index: number) => ({
      name: section.name,
      instructions: null,
      slotIds: slots.filter((slot) => slot.sectionIndex === index).map((slot) => slot.slotId),
    }));
    return { spec, sections, slots, sets: [] };
  }
  const sections = run.plan.map((section) => {
    const now = run.states[String(section.nodeId)];
    return { ...section, ...(now && { state: now.state, flags: now.flags ?? [] }) };
  }) as unknown as NotesDocument["sections"];
  return { spec, sections };
}

/** A replacing question's badge: from the bank (imported, a teacher's, approved), checked, flagged or new. */
function stateOf(question: { origin: string; status: string }): SlotState {
  if (question.status === "flagged") return "flagged";
  if (question.origin !== "generated" || question.status === "approved") return "bank";
  return question.status === "verified" ? "verified" : "generated";
}

@Injectable()
export class DrizzleDocumentStore implements DocumentStore {
  constructor(private readonly orgDb: OrgDatabase) {}

  detail(orgId: string, userId: string, documentId: string): Promise<DocumentDetail | null> {
    return this.orgDb.run(orgId, async (tx) => {
      const [doc] = await tx
        .select()
        .from(d)
        .where(and(eq(d.id, documentId), eq(d.ownerId, userId)));
      if (!doc) return null;
      const run = await latestRun(tx, eq(r.documentId, documentId));
      const content =
        doc.currentVersion === 0 && run ? live(doc, run) : (doc.content as unknown as DocumentContent);
      const nodeIds = isPaper(content)
        ? [...content.spec.taxonomyNodeIds, ...content.slots.map((slot) => slot.taxonomyNodeId)]
        : [...content.spec.taxonomyNodeIds, ...content.sections.map((section) => section.nodeId)];
      return {
        document: {
          id: doc.id,
          kind: doc.kind as TaskKind, // documents the chat makes; other kinds come later
          title: doc.title,
          currentVersion: doc.currentVersion,
          updatedAt: doc.updatedAt.toISOString(),
        },
        content,
        questions: await this.questions(tx, questionIds(content)),
        nodeNames: await this.names(tx, nodeIds),
        generation: run?.progress ?? null,
      };
    });
  }

  versions(orgId: string, userId: string, documentId: string): Promise<DocumentVersionSummary[] | null> {
    return this.orgDb.run(orgId, async (tx) => {
      if (!(await this.owned(tx, userId, documentId))) return null;
      const rows = await tx
        .select({
          version: v.version,
          authorKind: v.authorKind,
          authorName: users.name,
          ops: v.ops,
          createdAt: v.createdAt,
        })
        .from(v)
        .leftJoin(users, eq(users.id, v.authorId))
        .where(eq(v.documentId, documentId))
        .orderBy(desc(v.version));
      return rows.map((row) => ({
        version: row.version,
        authorKind: row.authorKind,
        authorName: row.authorName,
        changes: [...new Set((row.ops as { op: string }[]).map((op) => op.op))],
        createdAt: row.createdAt.toISOString(),
      }));
    });
  }

  version(
    orgId: string,
    userId: string,
    documentId: string,
    version: number,
  ): Promise<DocumentVersion | null> {
    return this.orgDb.run(orgId, async (tx) => {
      if (!(await this.owned(tx, userId, documentId))) return null;
      const [row] = await tx
        .select({ content: v.content })
        .from(v)
        .where(and(eq(v.documentId, documentId), eq(v.version, version)));
      return row ? { version, content: row.content as unknown as DocumentContent } : null;
    });
  }

  edit(
    orgId: string,
    userId: string,
    documentId: string,
    baseVersion: number,
    ops: readonly EditOp[],
    apply: (content: DocumentContent, ops: readonly ResolvedOp[]) => DocumentContent,
  ): Promise<SaveOutcome | null> {
    return this.orgDb.run(orgId, async (tx) => {
      const doc = await this.locked(tx, userId, documentId);
      if (!doc) return null;
      const refused = this.refusal(doc, baseVersion);
      if (refused) return refused;
      const content = doc.content as unknown as DocumentContent;
      const resolved: ResolvedOp[] = [];
      for (const op of ops) {
        if (op.op === "edit_item") {
          resolved.push({ ...op, questionId: await this.rewrite(tx, orgId, userId, doc, content, op) });
        } else if (op.op === "replace_item") {
          const [question] = await tx
            .select({ origin: q.origin, status: q.status })
            .from(q)
            .where(eq(q.id, op.questionId));
          if (!question || question.status === "retired") {
            throw new DomainError("That question isn't in the bank.", "invalid");
          }
          resolved.push({ ...op, state: stateOf(question) });
        } else {
          resolved.push(op);
        }
      }
      return this.save(tx, orgId, userId, doc, apply(content, resolved), resolved);
    });
  }

  restore(
    orgId: string,
    userId: string,
    documentId: string,
    baseVersion: number,
    version: number,
  ): Promise<SaveOutcome | "no_version" | null> {
    return this.orgDb.run(orgId, async (tx) => {
      const doc = await this.locked(tx, userId, documentId);
      if (!doc) return null;
      const refused = this.refusal(doc, baseVersion);
      if (refused) return refused;
      const [old] = await tx
        .select({ content: v.content })
        .from(v)
        .where(and(eq(v.documentId, documentId), eq(v.version, version)));
      if (!old) return "no_version";
      const content = old.content as unknown as DocumentContent;
      return this.save(tx, orgId, userId, doc, content, [{ op: "restore", version }]);
    });
  }

  remove(orgId: string, userId: string, documentId: string): Promise<boolean | null> {
    return this.orgDb.run(orgId, async (tx) => {
      const doc = await this.locked(tx, userId, documentId);
      if (!doc) return null;
      const run = await latestRun(tx, eq(r.documentId, documentId));
      if (run && MAKING.includes(run.progress.status)) return false;
      // Questions the teacher wrote in it and never got approved go too: the bank never offers drafts again.
      // Generated and approved questions stay in the bank for the next paper.
      await tx
        .delete(q)
        .where(
          and(
            eq(q.origin, "teacher"),
            eq(q.status, "draft"),
            sql`${q.provenance}->>'documentId' = ${documentId}`,
          ),
        );
      await tx.delete(d).where(eq(d.id, documentId)); // its versions and runs go with it
      return true;
    });
  }

  private async owned(tx: Transaction, userId: string, documentId: string): Promise<boolean> {
    const [doc] = await tx
      .select({ id: d.id })
      .from(d)
      .where(and(eq(d.id, documentId), eq(d.ownerId, userId)));
    return Boolean(doc);
  }

  /** The document's row, locked so concurrent edits take their turns. */
  private async locked(tx: Transaction, userId: string, documentId: string): Promise<DocumentRow | null> {
    const [doc] = await tx
      .select()
      .from(d)
      .where(and(eq(d.id, documentId), eq(d.ownerId, userId)))
      .for("update");
    return doc ?? null;
  }

  private refusal(doc: DocumentRow, baseVersion: number): SaveOutcome | null {
    if (doc.currentVersion === 0) return { kind: "making" };
    if (doc.currentVersion !== baseVersion) return { kind: "conflict", current: doc.currentVersion };
    return null;
  }

  private async save(
    tx: Transaction,
    orgId: string,
    userId: string,
    doc: DocumentRow,
    content: DocumentContent,
    ops: readonly unknown[],
  ): Promise<SaveOutcome> {
    const version = doc.currentVersion + 1;
    await tx.insert(v).values({
      orgId,
      documentId: doc.id,
      version,
      content: content as unknown as Record<string, unknown>,
      ops: [...ops],
      authorKind: "user",
      authorId: userId,
    });
    await tx
      .update(d)
      .set({
        content: content as unknown as Record<string, unknown>,
        currentVersion: version,
        title: content.spec.title,
        updatedAt: new Date(),
      })
      .where(eq(d.id, doc.id));
    return { kind: "saved", version };
  }

  /**
   * A teacher's wording of a question becomes a new question in the bank (a draft until a reviewer approves
   * it), tagged like the one it replaces, so the version before keeps pointing at the original.
   */
  private async rewrite(
    tx: Transaction,
    orgId: string,
    userId: string,
    doc: DocumentRow,
    content: DocumentContent,
    op: Extract<EditOp, { op: "edit_item" }>,
  ): Promise<string> {
    if (!isPaper(content)) throw new DomainError("edit_item doesn't apply to notes.", "invalid");
    const slot = content.slots.find((s) => s.slotId === op.slotId);
    if (!slot) throw new DomainError(`There is no item ${op.slotId}.`, "invalid");
    const [old] = slot.questionId ? await tx.select().from(q).where(eq(q.id, slot.questionId)) : [];
    const section = content.spec.sections[slot.sectionIndex];
    const [made] = await tx
      .insert(q)
      .values({
        orgId,
        qtype: old?.qtype ?? slot.qtype,
        origin: "teacher",
        status: "draft",
        content: op.content as unknown as Record<string, unknown>,
        authoritativeLanguage: old?.authoritativeLanguage ?? (op.content.hi ? "hi" : "en"),
        answer: op.answer as unknown as Record<string, unknown>,
        marks: String(slot.marks),
        negativeMarks: section ? String(section.negativeMarks) : null,
        difficulty: old?.difficulty ?? slot.difficulty,
        examId: old?.examId ?? doc.examId,
        licence: old?.licence ?? "own",
        provenance: {
          ...(old?.provenance ?? {}),
          editedFrom: old?.id ?? null,
          documentId: doc.id,
          slotId: slot.slotId,
        },
        createdBy: userId,
      })
      .returning({ id: q.id });
    const tags = old
      ? await tx
          .select({ nodeId: qt.nodeId, isPrimary: qt.isPrimary })
          .from(qt)
          .where(eq(qt.questionId, old.id))
      : [];
    const rows = tags.length ? tags : [{ nodeId: slot.taxonomyNodeId, isPrimary: true }];
    await tx.insert(qt).values(
      rows.map((tag) => ({
        orgId,
        questionId: made!.id,
        nodeId: tag.nodeId,
        confidence: 1,
        method: "human" as const,
        isPrimary: tag.isPrimary,
      })),
    );
    return made!.id;
  }

  private async questions(tx: Transaction, ids: string[]): Promise<Record<string, CanvasQuestion>> {
    if (!ids.length) return {};
    const rows = await tx.select().from(q).where(inArray(q.id, ids));
    const cited = new Map(
      rows.map((row) => [
        row.id,
        ((row.provenance as { chunkIds?: string[] }).chunkIds ?? []).slice(0, SOURCES_PER_QUESTION),
      ]),
    );
    const chunkIds = [...new Set([...cited.values()].flat())];
    const passages = chunkIds.length
      ? await tx
          .select({
            chunkId: c.id,
            sourceId: c.sourceId,
            filename: src.filename,
            pageStart: c.pageStart,
            pageEnd: c.pageEnd,
            pageLabel: p.pageLabel,
            text: c.text,
          })
          .from(c)
          .innerJoin(src, eq(src.id, c.sourceId))
          .leftJoin(p, and(eq(p.sourceId, c.sourceId), eq(p.pageNo, c.pageStart)))
          .where(inArray(c.id, chunkIds))
      : [];
    const byChunk = new Map(
      passages.map((row): [string, CitationRef] => [
        row.chunkId,
        {
          chunkId: row.chunkId,
          sourceId: row.sourceId,
          filename: row.filename.split("/").pop() ?? row.filename,
          pageStart: row.pageStart,
          pageEnd: row.pageEnd,
          pageLabel: row.pageLabel,
          quote: row.text.split(/\s+/).join(" ").slice(0, 240),
        },
      ]),
    );
    return Object.fromEntries(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          qtype: row.qtype,
          origin: row.origin,
          status: row.status,
          content: row.content as unknown as CanvasQuestion["content"],
          answer: row.answer as unknown as CanvasQuestion["answer"],
          difficulty: row.difficulty,
          verification: row.verification,
          sources: (cited.get(row.id) ?? []).flatMap((id) => byChunk.get(id) ?? []),
        },
      ]),
    );
  }

  private async names(tx: Transaction, ids: string[]): Promise<Record<string, LocalizedText>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return {};
    const rows = await tx
      .select({ id: n.id, en: n.nameEn, hi: n.nameHi })
      .from(n)
      .where(inArray(n.id, unique));
    return Object.fromEntries(rows.map((row) => [row.id, { en: row.en, ...(row.hi && { hi: row.hi }) }]));
  }
}
