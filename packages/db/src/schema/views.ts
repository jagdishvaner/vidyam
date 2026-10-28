/** Read-only views over the tables, for screens that need counts rather than rows. */
import { sql } from "drizzle-orm";
import { integer, pgView, smallint, text, uuid } from "drizzle-orm/pg-core";

/**
 * How much content each syllabus node has (plan v3 §4, §6): passages by kind, and bank questions by type,
 * difficulty and status, counted at the node and every node above it, so a chapter counts its topics' content.
 * The chat's scope card shows these next to each chapter and topic, and paper planning reads them.
 *
 * Only trusted tags count (rules, people, or a model at 0.6 confidence or more); retired questions don't. It is
 * a plain view, always current, and runs with the reader's rights, so row-level security limits it to their
 * organization.
 */
export const coverageStats = pgView("coverage_stats", {
  orgId: uuid().notNull(),
  nodeId: uuid().notNull(),
  /** chunk or question */
  item: text().notNull(),
  /** The chunk's kind (prose, question, …) or the question's type (mcq_single, …). */
  kind: text().notNull(),
  difficulty: smallint(),
  /** Questions only: draft, verified, approved, … */
  status: text(),
  items: integer().notNull(),
}).with({ securityInvoker: true }).as(sql`
    with recursive lineage as (
      select id as node_id, id as ancestor_id from taxonomy_nodes
      union all
      select lineage.node_id, parent.parent_id
      from lineage join taxonomy_nodes parent on parent.id = lineage.ancestor_id
      where parent.parent_id is not null
    ),
    tagged as (
      select distinct ct.org_id, ct.chunk_id as item_id, 'chunk' as item, c.kind, null::smallint as difficulty,
        null::text as status, lineage.ancestor_id as node_id
      from chunk_tags ct
      join chunks c on c.id = ct.chunk_id
      join lineage on lineage.node_id = ct.node_id
      where ct.method <> 'llm' or ct.confidence >= 0.6
      union
      select distinct qt.org_id, qt.question_id, 'question', q.qtype, q.difficulty, q.status, lineage.ancestor_id
      from question_tags qt
      join questions q on q.id = qt.question_id
      join lineage on lineage.node_id = qt.node_id
      where (qt.method <> 'llm' or qt.confidence >= 0.6) and q.status <> 'retired'
    )
    select org_id, node_id, item, kind, difficulty, status, count(*)::int as items
    from tagged
    group by org_id, node_id, item, kind, difficulty, status
  `);
