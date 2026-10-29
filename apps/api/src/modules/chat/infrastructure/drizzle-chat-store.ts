import { Injectable } from "@nestjs/common";
import {
  AiPolicy,
  type AppendChatBlocksInput,
  type AppendChatBlocksResult,
  type ChatBlock,
  type ChatScopeNode,
  type ChatSessionDetail,
  type ChatSessionSummary,
  type ChatSessionUpdate,
  type DraftSpec,
} from "@vidyam/contracts";
import { schema, type Transaction } from "@vidyam/db";
import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";

import { OrgDatabase } from "../../../shared/database/org-database.js";
import type { BeginTurn, ChatStore, FinishedTurn, NewTurn, TurnRecord } from "../application/ports.js";
import { containsPattern, streamKey, TURN_TIMEOUT_MS, type CardNames } from "../domain/turns.js";

const {
  chatSessions: s,
  chatMessages: m,
  chatTurns: t,
  llmModels,
  orgSettings,
  exams: examsTable,
  examBlueprints,
  taxonomyNodes,
} = schema;
const UNANSWERED = ["pending", "streaming"] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ScopeRow extends Record<string, unknown> {
  id: string;
  parent_id: string | null;
  level: string;
  code: string;
  name_en: string;
  name_hi: string | null;
  passages: number;
  questions: number;
}

const turnColumns = {
  id: t.id,
  sessionId: t.sessionId,
  userMessageId: t.userMessageId,
  assistantMessageId: t.assistantMessageId,
  status: t.status,
  createdAt: t.createdAt,
};

function summary(row: typeof s.$inferSelect): ChatSessionSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    pinned: row.pinned,
    archived: row.archivedAt !== null,
    documentId: row.documentId,
    modelId: row.modelOverride,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function nextSeq(tx: Transaction, sessionId: string): Promise<number> {
  const [row] = await tx
    .select({ next: sql<number>`coalesce(max(${m.seq}), 0) + 1` })
    .from(m)
    .where(eq(m.sessionId, sessionId));
  return Number(row!.next);
}

/** Chats are a teacher's own: every query is limited to theirs, inside the center's row-level security. */
@Injectable()
export class DrizzleChatStore implements ChatStore {
  constructor(private readonly orgDb: OrgDatabase) {}

  list(
    orgId: string,
    userId: string,
    query: { q?: string; archived: boolean; offset: number; limit: number },
  ): Promise<ChatSessionSummary[]> {
    return this.orgDb.run(orgId, async (tx) => {
      const where: SQL[] = [
        eq(s.userId, userId),
        query.archived ? isNotNull(s.archivedAt) : isNull(s.archivedAt),
      ];
      if (query.q) {
        const pattern = containsPattern(query.q);
        // What was said, not the blocks' JSON keys: each block's text, or an answered card's summary.
        const said = sql`exists (
          select 1 from ${m}, jsonb_array_elements(${m.content}) as block
          where ${m.sessionId} = ${s.id}
            and (block->>'text' ilike ${pattern} or block->>'summary' ilike ${pattern}))`;
        where.push(or(ilike(s.title, pattern), said)!);
      }
      const rows = await tx
        .select()
        .from(s)
        .where(and(...where))
        .orderBy(desc(s.pinned), desc(s.updatedAt))
        .limit(query.limit)
        .offset(query.offset);
      return rows.map(summary);
    });
  }

  create(orgId: string, userId: string, modelId: string | null): Promise<ChatSessionSummary> {
    return this.orgDb.run(orgId, async (tx) => {
      const [row] = await tx.insert(s).values({ orgId, userId, modelOverride: modelId }).returning();
      return summary(row!);
    });
  }

  detail(orgId: string, userId: string, sessionId: string, now: Date): Promise<ChatSessionDetail | null> {
    return this.orgDb.run(orgId, async (tx) => {
      const [session] = await tx
        .select()
        .from(s)
        .where(and(eq(s.id, sessionId), eq(s.userId, userId)));
      if (!session) return null;
      const messages = await tx
        .select()
        .from(m)
        .where(and(eq(m.sessionId, sessionId), inArray(m.role, ["user", "assistant"])))
        .orderBy(asc(m.seq));
      const [active] = await tx
        .select({ id: t.id })
        .from(t)
        .where(
          and(
            eq(t.sessionId, sessionId),
            inArray(t.status, [...UNANSWERED]),
            gt(t.createdAt, new Date(now.getTime() - TURN_TIMEOUT_MS)),
          ),
        )
        .orderBy(desc(t.createdAt))
        .limit(1);
      return {
        session: summary(session),
        draftSpec: (session.draftSpec as DraftSpec | null) ?? null,
        messages: messages.map((row) => ({
          id: row.id,
          seq: row.seq,
          role: row.role as "user" | "assistant",
          blocks: row.content as ChatBlock[],
          modelId: row.modelId,
          createdAt: row.createdAt.toISOString(),
        })),
        activeTurnId: active?.id ?? null,
      };
    });
  }

  update(
    orgId: string,
    userId: string,
    sessionId: string,
    update: ChatSessionUpdate,
  ): Promise<ChatSessionSummary | null> {
    return this.orgDb.run(orgId, async (tx) => {
      const [row] = await tx
        .update(s)
        .set({
          ...(update.title !== undefined && { title: update.title }),
          ...(update.pinned !== undefined && { pinned: update.pinned }),
          ...(update.archived !== undefined && {
            archivedAt: update.archived ? sql`coalesce(${s.archivedAt}, now())` : null,
          }),
          ...(update.modelId !== undefined && { modelOverride: update.modelId }),
          // Renaming, pinning or archiving isn't activity: the chat keeps its place in the history.
          updatedAt: sql`${s.updatedAt}`,
        })
        .where(and(eq(s.id, sessionId), eq(s.userId, userId)))
        .returning();
      return row ? summary(row) : null;
    });
  }

  remove(orgId: string, userId: string, sessionId: string): Promise<boolean> {
    return this.orgDb.run(orgId, async (tx) => {
      const gone = await tx
        .delete(s)
        .where(and(eq(s.id, sessionId), eq(s.userId, userId)))
        .returning({ id: s.id });
      return gone.length > 0;
    });
  }

  selectableModels(orgId: string): Promise<string[]> {
    return this.orgDb.run(orgId, async (tx) => {
      const [center] = await tx.select({ aiPolicy: orgSettings.aiPolicy }).from(orgSettings);
      const policy = AiPolicy.parse(center?.aiPolicy ?? {});
      const models = await tx
        .select({ id: llmModels.id })
        .from(llmModels)
        .where(and(eq(llmModels.enabled, true), eq(llmModels.teacherSelectable, true)));
      const ids = models.map((model) => model.id);
      return policy.allowedModelIds.length ? ids.filter((id) => policy.allowedModelIds.includes(id)) : ids;
    });
  }

  names(
    orgId: string,
    refs: { examCodes: string[]; nodeIds: string[]; blueprintIds: string[] },
  ): Promise<CardNames> {
    return this.orgDb.run(orgId, async (tx) => {
      const exams = refs.examCodes.length
        ? await tx
            .select({ key: examsTable.code, name: examsTable.nameEn })
            .from(examsTable)
            .where(inArray(examsTable.code, refs.examCodes))
        : [];
      const nodes = refs.nodeIds.length
        ? await tx
            .select({ key: taxonomyNodes.id, name: taxonomyNodes.nameEn })
            .from(taxonomyNodes)
            .where(inArray(taxonomyNodes.id, refs.nodeIds))
        : [];
      const blueprints = refs.blueprintIds.length
        ? await tx
            .select({ key: examBlueprints.id, name: examBlueprints.name })
            .from(examBlueprints)
            .where(inArray(examBlueprints.id, refs.blueprintIds))
        : [];
      const byKey = (rows: { key: string; name: string }[]) =>
        Object.fromEntries(rows.map((r) => [r.key, r.name]));
      return { exams: byKey(exams), nodes: byKey(nodes), blueprints: byKey(blueprints) };
    });
  }

  scope(orgId: string, examCode: string | null, ids: string[]): Promise<ChatScopeNode[]> {
    return this.orgDb.run(orgId, async (tx) => {
      // One array literal parameter (Drizzle would spread a JS array into a list); every id is a checked UUID.
      const asked = ids.filter((id) => UUID_PATTERN.test(id));
      // The exam's syllabus to its topics (or every subject's chapters), plus the asked-for nodes and what
      // is above them; counts include everything below a node (coverage_stats).
      const rows = await tx.execute<ScopeRow>(sql`
        with recursive below as (
          select n.id from taxonomy_nodes n
          where ${examCode}::text is not null and n.id in (
            select es.node_id from exam_syllabus es join exams e on e.id = es.exam_id where e.code = ${examCode})
          union
          select c.id from taxonomy_nodes c join below on c.parent_id = below.id
        ),
        above as (
          select n.id, n.parent_id from taxonomy_nodes n where n.id = any(${`{${asked.join(",")}}`}::uuid[])
          union
          select p.id, p.parent_id from taxonomy_nodes p join above on p.id = above.parent_id
        ),
        counts as (
          select node_id,
            coalesce(sum(items) filter (where item = 'chunk'), 0)::int as passages,
            coalesce(sum(items) filter (where item = 'question' and status in ('approved', 'verified')), 0)::int
              as questions
          from coverage_stats group by node_id
        )
        select n.id, n.parent_id, n.level, n.code, n.name_en, n.name_hi,
          coalesce(c.passages, 0) as passages, coalesce(c.questions, 0) as questions
        from taxonomy_nodes n left join counts c on c.node_id = n.id
        where n.is_active and (
          n.id in (select id from below) or n.id in (select id from above)
          or (${examCode}::text is null and n.level in ('subject', 'unit', 'chapter')))
        order by n.sort_order, n.name_en`);
      return rows.rows.map((row) => ({
        id: row.id,
        parentId: row.parent_id,
        level: row.level,
        code: row.code,
        nameEn: row.name_en,
        nameHi: row.name_hi,
        passages: Number(row.passages),
        questions: Number(row.questions),
      }));
    });
  }

  existingTurn(
    orgId: string,
    userId: string,
    sessionId: string,
    clientTurnId: string,
  ): Promise<TurnRecord | null> {
    return this.orgDb.run(orgId, async (tx) => {
      const [row] = await tx
        .select(turnColumns)
        .from(t)
        .innerJoin(s, eq(s.id, t.sessionId))
        .where(and(eq(t.sessionId, sessionId), eq(t.clientTurnId, clientTurnId), eq(s.userId, userId)));
      return row ?? null;
    });
  }

  beginTurn(orgId: string, userId: string, sessionId: string, turn: NewTurn): Promise<BeginTurn | null> {
    return this.orgDb.run(orgId, async (tx) => {
      // The chat's row is locked, so two requests for one chat take their turns one after the other.
      const [session] = await tx
        .select({ id: s.id })
        .from(s)
        .where(and(eq(s.id, sessionId), eq(s.userId, userId)))
        .for("update");
      if (!session) return null;
      const [existing] = await tx
        .select(turnColumns)
        .from(t)
        .where(and(eq(t.sessionId, sessionId), eq(t.clientTurnId, turn.clientTurnId)));
      if (existing) return { kind: "existing", turn: existing };
      const unanswered = await tx
        .select({ id: t.id, createdAt: t.createdAt })
        .from(t)
        .where(and(eq(t.sessionId, sessionId), inArray(t.status, [...UNANSWERED])));
      if (unanswered.some((other) => other.createdAt >= turn.staleBefore)) return { kind: "busy" };
      if (unanswered.length) {
        await tx
          .update(t)
          .set({ status: "failed", error: "interrupted: the answer was lost", finishedAt: new Date() })
          .where(
            inArray(
              t.id,
              unanswered.map((other) => other.id),
            ),
          );
      }

      const [message] = await tx
        .insert(m)
        .values({ orgId, sessionId, seq: await nextSeq(tx, sessionId), role: "user", content: turn.blocks })
        .returning({ id: m.id });
      const turnId = crypto.randomUUID();
      const [created] = await tx
        .insert(t)
        .values({
          id: turnId,
          orgId,
          sessionId,
          clientTurnId: turn.clientTurnId,
          userMessageId: message!.id,
          status: "streaming",
          streamKey: streamKey(turnId),
        })
        .returning(turnColumns);
      // Activity: the chat moves to the top of the history, and out of the archive.
      await tx.update(s).set({ archivedAt: null }).where(eq(s.id, sessionId));
      return { kind: "created", turn: created! };
    });
  }

  finishTurn(orgId: string, finished: FinishedTurn): Promise<void> {
    return this.orgDb.run(orgId, async (tx) => {
      const known = finished.modelId
        ? (await tx.select({ id: llmModels.id }).from(llmModels).where(eq(llmModels.id, finished.modelId)))
            .length > 0
        : false;
      await tx.insert(m).values({
        id: finished.assistantMessageId,
        orgId,
        sessionId: finished.sessionId,
        seq: await nextSeq(tx, finished.sessionId),
        role: "assistant",
        content: finished.blocks,
        modelId: known ? finished.modelId : null,
      });
      await tx
        .update(t)
        .set({
          status: finished.status,
          assistantMessageId: finished.assistantMessageId,
          error: finished.error,
          finishedAt: new Date(),
        })
        .where(eq(t.id, finished.turnId));
      await tx
        .update(s)
        .set({
          status: finished.sessionStatus,
          ...(finished.title && {
            title: sql`case when ${s.title} = '' then ${finished.title} else ${s.title} end`,
          }),
          ...(finished.draftSpec && { draftSpec: finished.draftSpec }),
        })
        .where(eq(s.id, finished.sessionId));
    });
  }

  turn(orgId: string, userId: string, turnId: string): Promise<TurnRecord | null> {
    return this.orgDb.run(orgId, async (tx) => {
      const [row] = await tx
        .select(turnColumns)
        .from(t)
        .innerJoin(s, eq(s.id, t.sessionId))
        .where(and(eq(t.id, turnId), eq(s.userId, userId)));
      return row ?? null;
    });
  }

  appendFromWorkflow(input: AppendChatBlocksInput): Promise<AppendChatBlocksResult | null> {
    return this.orgDb.run(input.orgId, async (tx) => {
      // The chat's row is locked, so the message's place (seq) can't clash with a turn being answered.
      const [session] = await tx.select({ id: s.id }).from(s).where(eq(s.id, input.sessionId)).for("update");
      if (!session) return null;
      const written = await tx
        .insert(m)
        .values({
          id: input.messageId,
          orgId: input.orgId,
          sessionId: input.sessionId,
          seq: await nextSeq(tx, input.sessionId),
          role: "assistant",
          content: input.blocks,
        })
        .onConflictDoNothing({ target: m.id })
        .returning({ id: m.id });
      if (written.length) await tx.update(s).set({ status: "idle" }).where(eq(s.id, input.sessionId));
      return { messageId: input.messageId, created: written.length > 0 };
    });
  }

  failTurn(orgId: string, turnId: string, error: string): Promise<void> {
    return this.orgDb.run(orgId, async (tx) => {
      await tx
        .update(t)
        .set({ status: "failed", error, finishedAt: new Date() })
        .where(and(eq(t.id, turnId), inArray(t.status, [...UNANSWERED])));
    });
  }
}
