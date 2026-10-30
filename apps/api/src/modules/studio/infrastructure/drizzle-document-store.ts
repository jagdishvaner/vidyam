import { Injectable } from "@nestjs/common";
import type {
  ApplyDocumentEditsInput,
  ApplyDocumentEditsResult,
  CanvasQuestion,
  ChatBlock,
  CitationRef,
  DocumentContent,
  DocumentDetail,
  DocumentListItem,
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

const MOVED_ON =
  "The paper changed while I was rewriting, so I left it as it was. Ask again to change the newest version.";
const FINISHED = ["done", "failed", "cancelled"];

const {
  chatMessages: m,
  chatSessions: sessions,
  documents: d,
  documentExports: x,
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

/** While some items are being written again (EditDocument), they show as being written. */
function rewriting(content: DocumentContent, run: LatestRun): DocumentContent {
  const ids = new Set(run.plan.map((item) => String(item.slotId ?? item.nodeId)));
  if (isPaper(content)) {
    return {
      ...content,
      slots: content.slots.map((slot) =>
        ids.has(slot.slotId) ? { ...slot, state: "pending" as const } : slot,
      ),
    };
  }
  const notes: NotesDocument = content;
  return {
    ...notes,
    sections: notes.sections.map((section) =>
      ids.has(section.nodeId) ? { ...section, state: "pending" as const } : section,
    ),
  };
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

  list(orgId: string, userId: string, limit: number): Promise<DocumentListItem[]> {
    return this.orgDb.run(orgId, async (tx) => {
      // Where it opens: the teacher's chat that holds it, else the chat its first run was asked in.
      // Plain SQL with aliases: in a select list Drizzle prints columns unqualified, which would make these
      // subqueries compare their own ids.
      const chat = sql<string | null>`coalesce(
        (select s.id from chat_sessions s where s.document_id = documents.id and s.user_id = ${userId}
          order by s.updated_at desc limit 1),
        (select r.session_id from generation_runs r where r.document_id = documents.id
          and r.session_id is not null order by r.started_at limit 1))`;
      const rows = await tx
        .select({
          id: d.id,
          kind: d.kind,
          title: d.title,
          currentVersion: d.currentVersion,
          updatedAt: d.updatedAt,
          chatId: chat,
        })
        .from(d)
        .where(eq(d.ownerId, userId))
        .orderBy(desc(d.updatedAt))
        .limit(limit);
      return rows.map((row) => ({
        id: row.id,
        kind: row.kind as TaskKind,
        title: row.title,
        currentVersion: row.currentVersion,
        updatedAt: row.updatedAt.toISOString(),
        chatId: row.chatId,
      }));
    });
  }

  detail(orgId: string, userId: string, documentId: string): Promise<DocumentDetail | null> {
    return this.orgDb.run(orgId, async (tx) => {
      const [doc] = await tx
        .select()
        .from(d)
        .where(and(eq(d.id, documentId), eq(d.ownerId, userId)));
      if (!doc) return null;
      const run = await latestRun(tx, eq(r.documentId, documentId));
      const saved = doc.content as unknown as DocumentContent;
      const content =
        doc.currentVersion === 0 && run
          ? live(doc, run)
          : run && MAKING.includes(run.progress.status)
            ? rewriting(saved, run)
            : saved;
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
    author: "user" | "agent" = "user",
  ): Promise<SaveOutcome | null> {
    return this.orgDb.run(orgId, async (tx) => {
      const doc = await this.locked(tx, userId, documentId);
      if (!doc) return null;
      const refused = this.refusal(doc, baseVersion);
      if (refused) return refused;
      const content = doc.content as unknown as DocumentContent;
      const resolved = await this.resolve(tx, orgId, userId, doc, content, ops);
      return this.save(tx, orgId, doc, apply(content, resolved), resolved, {
        kind: author,
        id: author === "user" ? userId : null,
      });
    });
  }

  applyFromWorkflow(
    input: ApplyDocumentEditsInput,
    apply: (content: DocumentContent, ops: readonly ResolvedOp[]) => DocumentContent,
  ): Promise<ApplyDocumentEditsResult | null> {
    return this.orgDb.run(input.orgId, async (tx) => {
      // A retry finds its message (or its run finished) and answers as the first try did.
      const [said] = await tx.select({ id: m.id }).from(m).where(eq(m.id, input.messageId));
      const [run] = await tx.select({ status: r.status }).from(r).where(eq(r.id, input.runId)).for("update");
      if (!run) return null;
      if (said || FINISHED.includes(run.status)) {
        const [saved] = await tx
          .select({ version: v.version })
          .from(v)
          .where(and(eq(v.documentId, input.documentId), eq(v.chatMessageId, input.messageId)));
        return saved ? { version: saved.version, outcome: "saved" } : { version: null, outcome: "nothing" };
      }
      const [doc] = await tx.select().from(d).where(eq(d.id, input.documentId)).for("update");
      if (!doc) return null;
      let result: ApplyDocumentEditsResult;
      let next: { content: DocumentContent; ops: readonly ResolvedOp[] } | null = null;
      if (doc.currentVersion !== input.baseVersion) {
        result = { version: null, outcome: "moved_on" };
      } else if (!input.ops.length) {
        result = { version: null, outcome: "nothing" };
      } else {
        const content = doc.content as unknown as DocumentContent;
        const ops = await this.resolve(tx, input.orgId, doc.ownerId, doc, content, input.ops);
        next = { content: apply(content, ops), ops };
        result = { version: doc.currentVersion + 1, outcome: "saved" };
      }
      // The chat's message first: the version names it as what made it.
      if (input.sessionId) {
        const blocks: ChatBlock[] =
          result.outcome === "saved"
            ? [
                {
                  type: "edit_summary",
                  documentId: doc.id,
                  fromVersion: input.baseVersion,
                  toVersion: result.version!,
                  summary: input.summary,
                  ops: input.ops,
                },
              ]
            : result.outcome === "nothing"
              ? [{ type: "notice", level: "warning", text: input.summary }]
              : [{ type: "error", code: "moved_on", message: MOVED_ON }];
        await this.say(tx, input.orgId, input.sessionId, input.messageId, blocks);
      }
      if (next) {
        await this.save(tx, input.orgId, doc, next.content, next.ops, {
          kind: "agent",
          id: null,
          chatMessageId: input.sessionId ? input.messageId : null,
        });
      }
      await tx
        .update(r)
        .set({
          status: result.outcome === "moved_on" ? "failed" : "done",
          error: result.outcome === "moved_on" ? MOVED_ON : null,
          finishedAt: new Date(),
        })
        .where(eq(r.id, input.runId));
      return result;
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
      return this.save(tx, orgId, doc, content, [{ op: "restore", version }], { kind: "user", id: userId });
    });
  }

  remove(orgId: string, userId: string, documentId: string): Promise<string[] | false | null> {
    return this.orgDb.run(orgId, async (tx) => {
      const doc = await this.locked(tx, userId, documentId);
      if (!doc) return null;
      const run = await latestRun(tx, eq(r.documentId, documentId));
      if (run && MAKING.includes(run.progress.status)) return false;
      const files = await tx.select({ key: x.s3Key }).from(x).where(eq(x.documentId, documentId));
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
      await tx.delete(d).where(eq(d.id, documentId)); // its versions, runs and exports go with it
      return files.flatMap((file) => (file.key ? [file.key] : []));
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

  /** What edit operations become once the API has done its part (ResolvedOp). */
  private async resolve(
    tx: Transaction,
    orgId: string,
    userId: string,
    doc: DocumentRow,
    content: DocumentContent,
    ops: readonly EditOp[],
  ): Promise<ResolvedOp[]> {
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
    return resolved;
  }

  /** An assistant message in the chat, after its latest; the chat is free again. */
  private async say(
    tx: Transaction,
    orgId: string,
    sessionId: string,
    messageId: string,
    blocks: ChatBlock[],
  ): Promise<void> {
    const [session] = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .for("update");
    if (!session) return;
    const [last] = await tx
      .select({ seq: sql<number>`coalesce(max(${m.seq}), 0)` })
      .from(m)
      .where(eq(m.sessionId, sessionId));
    await tx.insert(m).values({
      id: messageId,
      orgId,
      sessionId,
      seq: Number(last?.seq ?? 0) + 1,
      role: "assistant",
      content: blocks,
    });
    await tx.update(sessions).set({ status: "idle" }).where(eq(sessions.id, sessionId));
  }

  private async save(
    tx: Transaction,
    orgId: string,
    doc: DocumentRow,
    content: DocumentContent,
    ops: readonly unknown[],
    author: { kind: "user" | "agent"; id: string | null; chatMessageId?: string | null },
  ): Promise<SaveOutcome> {
    const version = doc.currentVersion + 1;
    await tx.insert(v).values({
      orgId,
      documentId: doc.id,
      version,
      content: content as unknown as Record<string, unknown>,
      ops: [...ops],
      authorKind: author.kind,
      authorId: author.id,
      chatMessageId: author.chatMessageId ?? null,
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
