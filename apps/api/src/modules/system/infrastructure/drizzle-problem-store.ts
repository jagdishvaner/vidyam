import { Inject, Injectable } from "@nestjs/common";
import type { Problem } from "@vidyam/contracts";
import { schema, type DatabaseHandle } from "@vidyam/db";
import { sql } from "drizzle-orm";

import { OrgDatabase } from "../../../shared/database/org-database.js";
import { DATABASE } from "../../../shared/database/tokens.js";
import type { ProblemStore } from "../application/list-problems.js";

interface Row extends Record<string, unknown> {
  kind: Problem["kind"];
  id: string;
  at: Date | string;
  subject: string;
  person: string | null;
  error: string | null;
  count: number;
}

/**
 * Failures as the services record them: a failed generation run, export, chat turn or file, and AI calls
 * with an error, grouped by task, model and error so a retry storm is one line.
 */
@Injectable()
export class DrizzleProblemStore implements ProblemStore {
  constructor(
    private readonly orgDb: OrgDatabase,
    @Inject(DATABASE) private readonly database: DatabaseHandle,
  ) {}

  since(orgId: string, since: Date, limit: number): Promise<Problem[]> {
    const from = since.toISOString();
    return this.orgDb.run(orgId, async (tx) => {
      const rows = await tx.execute<Row>(sql`
        select * from (
          select 'generation' as kind, g.id::text as id, coalesce(g.finished_at, g.started_at) as at,
                 d.title as subject, u.name as person, g.error, 1 as count
          from generation_runs g join documents d on d.id = g.document_id left join users u on u.id = d.owner_id
          where g.status = 'failed' and coalesce(g.finished_at, g.started_at) > ${from}
          union all
          select 'export', e.id::text, coalesce(e.finished_at, e.created_at),
                 d.title || ' (' || e.format || ', ' || e.variant || coalesce(', set ' || e.set_code, '') || ')',
                 u.name, e.error, 1
          from document_exports e join documents d on d.id = e.document_id left join users u on u.id = e.created_by
          where e.status = 'failed' and coalesce(e.finished_at, e.created_at) > ${from}
          union all
          select 'chat', t.id::text, coalesce(t.finished_at, t.created_at), coalesce(nullif(s.title, ''), 'Chat'),
                 u.name, t.error, 1
          from chat_turns t join chat_sessions s on s.id = t.session_id left join users u on u.id = s.user_id
          where t.status = 'failed' and coalesce(t.finished_at, t.created_at) > ${from}
          union all
          select 'ai_call', (array_agg(c.id::text order by c.created_at desc))[1], max(c.created_at),
                 c.task || ' · ' || c.model_id, null, c.error, count(*)::int
          from llm_calls c
          where c.error is not null and c.created_at > ${from}
          group by c.task, c.model_id, c.error
          union all
          select 'source', s.id::text, s.updated_at, coalesce(s.title, s.filename), u.name, s.error, 1
          from sources s left join users u on u.id = s.uploaded_by
          where s.status = 'failed' and s.updated_at > ${from}
        ) problems
        order by at desc
        limit ${limit}`);
      return rows.rows.map((row) => ({
        kind: row.kind,
        id: row.id,
        at: new Date(row.at).toISOString(),
        subject: row.subject,
        person: row.person,
        error: (row.error ?? "").slice(0, 500) || "(no message recorded)",
        count: Number(row.count),
      }));
    });
  }

  organizations(): Promise<{ id: string; name: string }[]> {
    return this.database.db
      .select({ id: schema.organizations.id, name: schema.organizations.name })
      .from(schema.organizations);
  }
}
