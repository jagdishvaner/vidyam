import { Injectable } from "@nestjs/common";
import type { CoverageReport } from "@vidyam/contracts";
import { sql } from "drizzle-orm";

import { OrgDatabase } from "../../../shared/database/org-database.js";
import type { CoverageStore } from "../application/get-coverage.js";

interface Row extends Record<string, unknown> {
  id: string;
  name_en: string;
  name_hi: string | null;
  chapters: number;
  chapters_with_material: number;
  passages: number;
  questions: number;
}

/**
 * Per subject (a syllabus tree's root): its chapters, those with any passage, and the passages and banked
 * questions under it. coverage_stats already counts each item under every node above its tags.
 */
@Injectable()
export class DrizzleCoverageStore implements CoverageStore {
  constructor(private readonly orgDb: OrgDatabase) {}

  bySubject(orgId: string): Promise<CoverageReport> {
    return this.orgDb.run(orgId, async (tx) => {
      const rows = await tx.execute<Row>(sql`
        with recursive tree as (
          select id, id as subject_id, level from taxonomy_nodes where parent_id is null and is_active
          union all
          select n.id, t.subject_id, n.level from taxonomy_nodes n join tree t on n.parent_id = t.id
          where n.is_active
        ),
        material as (
          select node_id, sum(items) filter (where item = 'chunk') as passages,
                 sum(items) filter (where item = 'question' and status in ('approved', 'verified')) as questions
          from coverage_stats group by node_id
        )
        select s.id, s.name_en, s.name_hi,
          (select count(*) from tree t where t.subject_id = s.id and t.level = 'chapter')::int as chapters,
          (select count(*) from tree t join material m on m.node_id = t.id
           where t.subject_id = s.id and t.level = 'chapter' and m.passages > 0)::int as chapters_with_material,
          coalesce((select passages from material m where m.node_id = s.id), 0)::int as passages,
          coalesce((select questions from material m where m.node_id = s.id), 0)::int as questions
        from taxonomy_nodes s
        where s.parent_id is null and s.is_active
        order by passages desc, s.sort_order, s.name_en`);
      return {
        subjects: rows.rows.map((row) => ({
          nodeId: row.id,
          name: { en: row.name_en, ...(row.name_hi && { hi: row.name_hi }) },
          chapters: Number(row.chapters),
          chaptersWithMaterial: Number(row.chapters_with_material),
          passages: Number(row.passages),
          questions: Number(row.questions),
        })),
      };
    });
  }
}
