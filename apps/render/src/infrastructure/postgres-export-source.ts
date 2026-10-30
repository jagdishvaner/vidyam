import {
  OrgBranding,
  type DocumentContent,
  type ExportFormat,
  type ExportVariant,
  type QuestionType,
} from "@vidyam/contracts";
import { schema, withOrgContext, type DatabaseHandle } from "@vidyam/db";
import { and, eq, inArray } from "drizzle-orm";

import type { ExportJob, ExportSource } from "../application/render-export.js";
import type { PrintQuestion } from "../domain/print.js";

const { documentExports: x, documentVersions: v, documents: d, exams, orgSettings, questions: q } = schema;

/** Reads what an export prints, under the center's row-level security. The render worker never writes here. */
export class PostgresExportSource implements ExportSource {
  constructor(private readonly database: DatabaseHandle) {}

  load(orgId: string, exportId: string): Promise<ExportJob | null> {
    return withOrgContext(this.database.db, orgId, async (tx) => {
      const [job] = await tx
        .select({
          documentId: x.documentId,
          version: x.version,
          format: x.format,
          variant: x.variant,
          setCode: x.setCode,
          examId: d.examId,
        })
        .from(x)
        .innerJoin(d, eq(d.id, x.documentId))
        .where(eq(x.id, exportId));
      if (!job) return null;
      const [version] = await tx
        .select({ content: v.content })
        .from(v)
        .where(and(eq(v.documentId, job.documentId), eq(v.version, job.version)));
      if (!version) return null;
      const content = version.content as unknown as DocumentContent;
      const ids =
        "slots" in content ? content.slots.flatMap((slot) => (slot.questionId ? [slot.questionId] : [])) : [];
      const rows = ids.length
        ? await tx
            .select({ id: q.id, qtype: q.qtype, content: q.content, answer: q.answer })
            .from(q)
            .where(inArray(q.id, ids))
        : [];
      const [exam] = job.examId
        ? await tx.select({ en: exams.nameEn, hi: exams.nameHi }).from(exams).where(eq(exams.id, job.examId))
        : [];
      const [settings] = await tx.select({ branding: orgSettings.branding }).from(orgSettings);
      const branding = settings ? OrgBranding.safeParse(settings.branding) : null;
      return {
        exportId,
        documentId: job.documentId,
        format: job.format as ExportFormat,
        request: {
          content,
          questions: Object.fromEntries(
            rows.map((row): [string, PrintQuestion] => [
              row.id,
              {
                qtype: row.qtype as QuestionType,
                content: row.content as unknown as PrintQuestion["content"],
                answer: row.answer as unknown as PrintQuestion["answer"],
              },
            ]),
          ),
          branding: branding?.success ? branding.data : null,
          examName: exam ? (exam.hi ? `${exam.hi} / ${exam.en}` : exam.en) : null,
          variant: job.variant as ExportVariant,
          setCode: job.setCode,
        },
      };
    });
  }
}
