CREATE VIEW "public"."coverage_stats" WITH (security_invoker = true) AS (
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
  );