/**
 * The render worker (plan v3 step 29) against the test database, the exports bucket and a real Chromium: an
 * export is read under the center's row-level security, drawn as a PDF and as Word files, and stored. What it
 * stored is removed at the end.
 */
import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import type { PaperDocument } from "@vidyam/contracts";
import {
  createDatabase,
  runMigrations,
  schema,
  syncLocalAppRolePassword,
  type DatabaseHandle,
} from "@vidyam/db";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ExportNotFound, RenderExport } from "../src/application/render-export.js";
import { exportsBucket, loadEnv } from "../src/config/env.js";
import { DocxRenderer } from "../src/infrastructure/docx.js";
import { PdfRenderer } from "../src/infrastructure/pdf.js";
import { PostgresExportSource } from "../src/infrastructure/postgres-export-source.js";
import { createS3Client, S3FileStore } from "../src/infrastructure/s3-file-store.js";

const env = loadEnv();
const testDbUrl = process.env.VIDYAM_TEST_DATABASE_URL!;
const testAdminUrl = process.env.VIDYAM_TEST_DATABASE_ADMIN_URL!;
const orgId = crypto.randomUUID();
const email = `render-${orgId}@vidyam.test`;
const s3 = createS3Client(env);
const stored: string[] = [];

let owner: DatabaseHandle;
let app: DatabaseHandle;
const pdf = new PdfRenderer();
let render: RenderExport;
let exportIds: Record<string, string>;

beforeAll(async () => {
  await runMigrations(testAdminUrl);
  await syncLocalAppRolePassword(testAdminUrl, testDbUrl);
  owner = createDatabase(testAdminUrl, { max: 2 });
  app = createDatabase(testDbUrl, { max: 2 });
  render = new RenderExport(
    new PostgresExportSource(app),
    { pdf, docx: new DocxRenderer() },
    new S3FileStore(s3, exportsBucket(env)),
  );
  await owner.db
    .insert(schema.organizations)
    .values({ id: orgId, name: "Render center", slug: `render-${orgId}`, createdAt: new Date() });
  const [user] = await owner.db
    .insert(schema.users)
    .values({ id: crypto.randomUUID(), name: "Render Teacher", email, emailVerified: true })
    .returning({ id: schema.users.id });
  const [node] = await owner.db
    .insert(schema.taxonomyNodes)
    .values({ orgId, level: "chapter", code: "force", nameEn: "Force", nameHi: "बल" })
    .returning({ id: schema.taxonomyNodes.id });
  const [question] = await owner.db
    .insert(schema.questions)
    .values({
      orgId, qtype: "mcq_single", origin: "generated", status: "verified", authoritativeLanguage: "hi",
      licence: "own", answer: { kind: "options", keys: ["A"] },
      content: {
        hi: { stem: "बल का SI मात्रक क्या है? $F = ma$", solution: null,
              options: ["न्यूटन", "जूल", "वाट", "पास्कल"].map((text, n) => ({ key: "ABCD"[n], text })) },
        en: { stem: "What is the SI unit of force? $F = ma$", solution: null,
              options: ["newton", "joule", "watt", "pascal"].map((text, n) => ({ key: "ABCD"[n], text })) },
      },
    })
    .returning({ id: schema.questions.id }); // prettier-ignore
  const content: PaperDocument = {
    spec: {
      kind: "question_paper", title: "बल परीक्षा / Force test", examCode: null, blueprintId: null,
      taxonomyNodeIds: [node!.id], languages: ["hi", "en"], layout: "hindi_then_english", durationMinutes: 10,
      sourcing: "bank_first", studentBatchId: null, setCodes: [],
      sections: [{ name: { en: "MCQ" }, qtype: "mcq_single", count: 1, marksEach: 2, negativeMarks: 0,
                   attemptAny: null, difficultyMix: { easy: 1, medium: 0, hard: 0 }, scope: [] }],
    },
    sections: [{ name: { en: "MCQ" }, instructions: null, slotIds: ["s1-1"] }],
    slots: [{ slotId: "s1-1", sectionIndex: 0, qtype: "mcq_single", taxonomyNodeId: node!.id, difficulty: 2,
              marks: 2, state: "verified", questionId: question!.id, flags: [] }],
    sets: [],
  }; // prettier-ignore
  const [doc] = await owner.db
    .insert(schema.documents)
    .values({ orgId, kind: "question_paper", title: content.spec.title, spec: content.spec, ownerId: user!.id,
              content: content as unknown as Record<string, unknown>, currentVersion: 1 })
    .returning({ id: schema.documents.id }); // prettier-ignore
  await owner.db.insert(schema.documentVersions).values({
    orgId,
    documentId: doc!.id,
    version: 1,
    content: content as unknown as Record<string, unknown>,
    authorKind: "agent",
  });
  exportIds = {};
  for (const [format, variant] of [
    ["pdf", "paper"],
    ["docx", "answer_key"],
    ["krutidev_docx", "paper"],
  ] as const) {
    const [row] = await owner.db
      .insert(schema.documentExports)
      .values({ orgId, documentId: doc!.id, version: 1, format, variant })
      .returning({ id: schema.documentExports.id });
    exportIds[format] = row!.id;
  }
});

afterAll(async () => {
  for (const key of stored) await s3.send(new DeleteObjectCommand({ Bucket: exportsBucket(env), Key: key }));
  await owner?.db.delete(schema.organizations).where(inArray(schema.organizations.id, [orgId]));
  await owner?.db.delete(schema.users).where(inArray(schema.users.email, [email]));
  await pdf.close();
  await owner?.pool.end();
  await app?.pool.end();
});

async function read(key: string): Promise<Uint8Array> {
  const object = await s3.send(new GetObjectCommand({ Bucket: exportsBucket(env), Key: key }));
  return object.Body!.transformToByteArray();
}

describe("RenderExport", () => {
  it("draws each format from the version the export names and stores it", async () => {
    for (const [format, magic] of [
      ["pdf", "%PDF"],
      ["docx", "PK"],
      ["krutidev_docx", "PK"],
    ] as const) {
      const made = await render.execute(orgId, exportIds[format]!);
      stored.push(made.s3Key);
      expect(made.s3Key).toMatch(new RegExp(`^${orgId}/.+/${exportIds[format]}\\.(pdf|docx)$`));
      const bytes = await read(made.s3Key);
      expect(bytes.byteLength).toBe(made.bytes);
      expect(new TextDecoder().decode(bytes.slice(0, magic.length))).toBe(magic);
    }
  });

  it("refuses an export another center can't see, or that isn't there", async () => {
    await expect(render.execute(crypto.randomUUID(), exportIds.pdf!)).rejects.toBeInstanceOf(ExportNotFound);
    await expect(render.execute(orgId, crypto.randomUUID())).rejects.toBeInstanceOf(ExportNotFound);
  });
});
