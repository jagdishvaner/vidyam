/**
 * The canvas's API (plan v3 step 27) against the test database: a teacher reads their document with its
 * questions, edits it against the version they saw, gets refused when it moved on meanwhile, undoes by
 * restoring an earlier version, sees a document being made slot by slot, and deletes it once made. Another
 * teacher sees none of it.
 */
import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { AuthService } from "@thallesp/nestjs-better-auth";
import type {
  DocumentDetail,
  DocumentExport,
  ExportDocumentInput,
  PaperDocument,
  QuestionContent,
} from "@vidyam/contracts";
import {
  createDatabase,
  runMigrations,
  schema,
  syncLocalAppRolePassword,
  type DatabaseHandle,
} from "@vidyam/db";
import { eq, inArray } from "drizzle-orm";
import { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { bucketName, loadEnv } from "../src/config/env.js";
import type { Auth } from "../src/modules/identity/infrastructure/better-auth.js";
import {
  EXPORT_STARTER,
  ExportDocuments,
  type ExportStarter,
} from "../src/modules/studio/application/export-documents.js";
import { ManageDocuments } from "../src/modules/studio/application/manage-documents.js";
import { createS3Client } from "../src/shared/storage/s3.js";

const base = loadEnv();
const testDbUrl = process.env.VIDYAM_TEST_DATABASE_URL!;
const testAdminUrl = process.env.VIDYAM_TEST_DATABASE_ADMIN_URL!;
const ORIGIN = base.VIDYAM_APP_URL;
const password = "a-long-test-password-1";
const orgId = crypto.randomUUID();
const emails = [`docs-a-${orgId}@vidyam.test`, `docs-b-${orgId}@vidyam.test`];

let app: INestApplication;
/** The stand-in for starting ExportDocument: what it was asked to start. */
const started: ExportDocumentInput[] = [];
const starter: ExportStarter = {
  start: async (input) => {
    started.push(input);
  },
};
const s3 = createS3Client(base);
let owner: DatabaseHandle;
let teacherA: string[];
let teacherB: string[];
let teacherAId: string;
let node: string;

const QUESTION: QuestionContent = {
  hi: {
    stem: "बल का SI मात्रक क्या है?",
    options: ["न्यूटन", "जूल", "वाट", "पास्कल"].map((text, n) => ({ key: "ABCD"[n]!, text })),
    solution: null,
  },
  en: null,
};

async function signIn(email: string): Promise<string[]> {
  const res = await request(app.getHttpServer())
    .post("/api/auth/sign-in/email")
    .set("Origin", ORIGIN)
    .send({ email, password })
    .expect(200);
  return res.get("Set-Cookie") ?? [];
}

async function question(): Promise<string> {
  const [row] = await owner.db
    .insert(schema.questions)
    .values({
      orgId,
      qtype: "mcq_single",
      origin: "generated",
      status: "verified",
      content: QUESTION as unknown as Record<string, unknown>,
      authoritativeLanguage: "hi",
      answer: { kind: "options", keys: ["A"] },
      difficulty: 2,
      licence: "own",
      provenance: { chunkIds: [] },
    })
    .returning({ id: schema.questions.id });
  await owner.db
    .insert(schema.questionTags)
    .values({ orgId, questionId: row!.id, nodeId: node, method: "generation", isPrimary: true });
  return row!.id;
}

/** A paper of two questions at version 1, as GeneratePaper saves it. */
async function madePaper(): Promise<{ id: string; content: PaperDocument; questions: string[] }> {
  const questions = [await question(), await question()];
  const content: PaperDocument = {
    spec: {
      kind: "question_paper", title: "Force test", examCode: null, blueprintId: null, taxonomyNodeIds: [node],
      sections: [{ name: { en: "MCQ" }, qtype: "mcq_single", count: 2, marksEach: 2, negativeMarks: 0.5,
                   attemptAny: null, difficultyMix: { easy: 1, medium: 0, hard: 0 }, scope: [] }],
      languages: ["hi"], layout: "single_language", durationMinutes: 10, sourcing: "bank_first",
      studentBatchId: null, setCodes: [],
    },
    sections: [{ name: { en: "MCQ" }, instructions: null, slotIds: ["s1-1", "s1-2"] }],
    slots: questions.map((id, n) => ({
      slotId: `s1-${n + 1}`, sectionIndex: 0, qtype: "mcq_single", taxonomyNodeId: node, difficulty: 2,
      marks: 2, state: "verified", questionId: id, flags: [],
    })),
    sets: [],
  }; // prettier-ignore
  const [doc] = await owner.db
    .insert(schema.documents)
    .values({
      orgId,
      kind: "question_paper",
      title: "Force test",
      spec: content.spec,
      content: content as unknown as Record<string, unknown>,
      currentVersion: 1,
      ownerId: teacherAId,
    })
    .returning({ id: schema.documents.id });
  await owner.db.insert(schema.documentVersions).values({
    orgId,
    documentId: doc!.id,
    version: 1,
    content: content as unknown as Record<string, unknown>,
    authorKind: "agent",
  });
  return { id: doc!.id, content, questions };
}

const get = (cookies: string[], path: string) =>
  request(app.getHttpServer()).get(`/api/documents/${path}`).set("Cookie", cookies);
const post = (cookies: string[], path: string, body: object) =>
  request(app.getHttpServer()).post(`/api/documents/${path}`).set("Cookie", cookies).send(body);

beforeAll(async () => {
  const redis = new Redis(base.VIDYAM_CACHE_REDIS_URL);
  const limits = await redis.keys("auth:*|/sign-in/email");
  if (limits.length) await redis.del(...limits);
  redis.disconnect();
  await runMigrations(testAdminUrl);
  await syncLocalAppRolePassword(testAdminUrl, testDbUrl);
  owner = createDatabase(testAdminUrl, { max: 2 });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({ ...base, VIDYAM_DATABASE_URL: testDbUrl })],
  })
    .overrideProvider(EXPORT_STARTER)
    .useValue(starter)
    .compile();
  app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
  app.setGlobalPrefix("api");
  await app.init();

  const auth = app.get<AuthService<Auth>>(AuthService);
  const ids = [];
  for (const email of emails) {
    ids.push((await auth.api.createUser({ body: { email, password, name: "Docs Teacher" } })).user.id);
  }
  teacherAId = ids[0]!;
  await owner.db
    .insert(schema.organizations)
    .values({ id: orgId, name: "Docs center", slug: `docs-${orgId}`, createdAt: new Date() });
  await owner.db
    .insert(schema.members)
    .values(ids.map((userId) => ({ organizationId: orgId, userId, role: "teacher", createdAt: new Date() })));
  const [chapter] = await owner.db
    .insert(schema.taxonomyNodes)
    .values({ orgId, level: "chapter", code: "force", nameEn: "Force", nameHi: "बल" })
    .returning({ id: schema.taxonomyNodes.id });
  node = chapter!.id;
  teacherA = await signIn(emails[0]!);
  teacherB = await signIn(emails[1]!);
});

afterAll(async () => {
  await owner?.db.delete(schema.organizations).where(inArray(schema.organizations.id, [orgId]));
  await owner?.db.delete(schema.users).where(inArray(schema.users.email, emails));
  await app?.close();
  await owner?.pool.end();
});

describe("documents", () => {
  it("reads, edits against the version seen, refuses stale edits, and undoes", async () => {
    const paper = await madePaper();
    const read = (await get(teacherA, paper.id).expect(200)).body as DocumentDetail;
    expect(read.document).toMatchObject({ title: "Force test", currentVersion: 1, kind: "question_paper" });
    expect(Object.keys(read.questions).sort()).toEqual([...paper.questions].sort());
    expect(read.questions[paper.questions[0]!]).toMatchObject({ status: "verified", sources: [] });
    expect(read.nodeNames[node]).toEqual({ en: "Force", hi: "बल" });

    const reworded: QuestionContent = { hi: { ...QUESTION.hi!, stem: "बल का मात्रक बताइए।" }, en: null };
    const edited = (
      await post(teacherA, `${paper.id}/edits`, {
        baseVersion: 1,
        ops: [
          { op: "edit_item", slotId: "s1-1", content: reworded, answer: { kind: "options", keys: ["A"] } },
          { op: "delete_items", slotIds: ["s1-2"] },
          { op: "set_title", title: "Force quiz" },
        ],
      }).expect(200)
    ).body as DocumentDetail;
    const slots = (edited.content as PaperDocument).slots;
    expect(edited.document).toMatchObject({ currentVersion: 2, title: "Force quiz" });
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ state: "edited" });
    const mine = edited.questions[slots[0]!.questionId!]!;
    expect(mine).toMatchObject({ origin: "teacher", status: "draft", content: reworded });
    const [tag] = await owner.db
      .select()
      .from(schema.questionTags)
      .where(eq(schema.questionTags.questionId, mine.id));
    expect(tag).toMatchObject({ nodeId: node, method: "human" }); // tagged like the question it replaced

    // An edit made on version 1 after version 2 exists would overwrite it: refused.
    const stale = await post(teacherA, `${paper.id}/edits`, {
      baseVersion: 1,
      ops: [{ op: "set_marks", slotId: "s1-1", marks: 3 }],
    }).expect(409);
    expect(stale.body.message).toContain("version 2");
    await post(teacherA, `${paper.id}/edits`, {
      baseVersion: 2,
      ops: [{ op: "set_marks", slotId: "s9-9", marks: 3 }],
    }).expect(422);

    // Undo: version 1 again, as version 3.
    const undone = (await post(teacherA, `${paper.id}/restore`, { baseVersion: 2, version: 1 }).expect(200))
      .body as DocumentDetail;
    expect(undone.document).toMatchObject({ currentVersion: 3, title: "Force test" });
    expect(undone.content).toEqual(paper.content);
    const versions = (await get(teacherA, `${paper.id}/versions`).expect(200)).body;
    expect(versions.map((v: { version: number; changes: string[] }) => [v.version, v.changes])).toEqual([
      [3, ["restore"]],
      [2, ["edit_item", "delete_items", "set_title"]],
      [1, []],
    ]);
    expect(versions[0]).toMatchObject({ authorKind: "user", authorName: "Docs Teacher" });
    const second = (await get(teacherA, `${paper.id}/versions/2`).expect(200)).body;
    expect(second.content.slots).toHaveLength(1);

    // Another teacher's documents are invisible.
    await get(teacherB, paper.id).expect(404);
    await post(teacherB, `${paper.id}/restore`, { baseVersion: 3, version: 2 }).expect(404);

    // Deleting it takes the teacher's own draft with it; the generated questions stay in the bank.
    await request(app.getHttpServer())
      .delete(`/api/documents/${paper.id}`)
      .set("Cookie", teacherA)
      .expect(204);
    const left = await owner.db
      .select({ id: schema.questions.id })
      .from(schema.questions)
      .where(inArray(schema.questions.id, [mine.id, ...paper.questions]));
    expect(left.map((row) => row.id).sort()).toEqual([...paper.questions].sort());
  });

  it("saves a workflow's rewrite with its chat message once, and leaves a paper that moved on alone", async () => {
    const paper = await madePaper();
    const replacement = await question();
    const [chat] = await owner.db
      .insert(schema.chatSessions)
      .values({ orgId, userId: teacherAId, status: "generating", documentId: paper.id })
      .returning({ id: schema.chatSessions.id });
    const run = async () => {
      const [row] = await owner.db
        .insert(schema.generationRuns)
        .values({
          orgId, documentId: paper.id, sessionId: chat!.id, workflowId: `EditDocument:${crypto.randomUUID()}`,
          spec: {}, status: "running", slotPlan: [{ slotId: "s1-2", state: "pending" }],
        })
        .returning({ id: schema.generationRuns.id }); // prettier-ignore
      return row!.id;
    };
    const runId = await run();
    // While it runs, the canvas shows question 2 as being written.
    const during = (await get(teacherA, paper.id).expect(200)).body as DocumentDetail;
    expect((during.content as PaperDocument).slots.map((s) => s.state)).toEqual(["verified", "pending"]);

    const documents = app.get(ManageDocuments);
    const input = {
      v: 1 as const, orgId, documentId: paper.id, runId, baseVersion: 1, sessionId: chat!.id,
      messageId: crypto.randomUUID(), summary: "Made question 2 harder.",
      ops: [{ op: "replace_item" as const, slotId: "s1-2", questionId: replacement }],
    }; // prettier-ignore
    expect(await documents.applyFromWorkflow(input)).toEqual({ version: 2, outcome: "saved" });
    expect(await documents.applyFromWorkflow(input)).toEqual({ version: 2, outcome: "saved" }); // a retry
    const after = (await get(teacherA, paper.id).expect(200)).body as DocumentDetail;
    expect(after.document.currentVersion).toBe(2);
    expect((after.content as PaperDocument).slots[1]).toMatchObject({
      questionId: replacement,
      state: "verified",
    });
    const [message] = await owner.db
      .select()
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.id, input.messageId));
    expect(message!.content).toEqual([
      { type: "edit_summary", documentId: paper.id, fromVersion: 1, toVersion: 2, summary: "Made question 2 harder.",
        ops: input.ops },
    ]); // prettier-ignore
    const [session] = await owner.db
      .select()
      .from(schema.chatSessions)
      .where(eq(schema.chatSessions.id, chat!.id));
    expect(session!.status).toBe("idle");
    const versions = (await get(teacherA, `${paper.id}/versions`).expect(200)).body;
    expect(versions[0]).toMatchObject({ version: 2, authorKind: "agent", changes: ["replace_item"] });

    // Written for version 1, but the paper is at 2 now: nothing changes, and the chat hears why.
    const late = { ...input, runId: await run(), messageId: crypto.randomUUID() };
    expect(await documents.applyFromWorkflow(late)).toEqual({ version: null, outcome: "moved_on" });
    const [refusal] = await owner.db
      .select()
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.id, late.messageId));
    expect(refusal!.content).toEqual([expect.objectContaining({ type: "error", code: "moved_on" })]);
    const [failed] = await owner.db
      .select()
      .from(schema.generationRuns)
      .where(eq(schema.generationRuns.id, late.runId));
    expect(failed!.status).toBe("failed");
  });

  it("shows a paper being made slot by slot, and deletes it only once made", async () => {
    const [doc] = await owner.db
      .insert(schema.documents)
      .values({
        orgId, kind: "question_paper", title: "Live test", ownerId: teacherAId,
        spec: (await madePaper()).content.spec, content: {},
      })
      .returning({ id: schema.documents.id }); // prettier-ignore
    const q = await question();
    const plan = ["s1-1", "s1-2"].map((slotId) => ({
      slotId, sectionIndex: 0, qtype: "mcq_single", taxonomyNodeId: node, difficulty: 2, marks: 2,
      state: "pending", questionId: null, flags: [],
    })); // prettier-ignore
    const [run] = await owner.db
      .insert(schema.generationRuns)
      .values({
        orgId, documentId: doc!.id, workflowId: `GeneratePaper:${doc!.id}`, spec: {}, slotPlan: plan,
        slotStates: { "s1-1": { state: "verified", questionId: q, flags: [] } }, status: "running",
      })
      .returning({ id: schema.generationRuns.id }); // prettier-ignore

    const live = (await get(teacherA, doc!.id).expect(200)).body as DocumentDetail;
    const content = live.content as PaperDocument;
    expect(content.slots.map((s) => [s.slotId, s.state, s.questionId])).toEqual([
      ["s1-1", "verified", q],
      ["s1-2", "pending", null],
    ]);
    expect(content.sections[0]!.slotIds).toEqual(["s1-1", "s1-2"]);
    expect(Object.keys(live.questions)).toEqual([q]);
    expect(live.generation).toMatchObject({ runId: run!.id, status: "running", done: 1, total: 2 });

    const making = await post(teacherA, `${doc!.id}/edits`, {
      baseVersion: 1,
      ops: [{ op: "set_title", title: "x" }],
    }).expect(409);
    expect(making.body.message).toContain("still being made");
    await request(app.getHttpServer())
      .delete(`/api/documents/${doc!.id}`)
      .set("Cookie", teacherA)
      .expect(409);

    await owner.db
      .update(schema.generationRuns)
      .set({ status: "done" })
      .where(eq(schema.generationRuns.id, run!.id));
    await request(app.getHttpServer())
      .delete(`/api/documents/${doc!.id}`)
      .set("Cookie", teacherB)
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/documents/${doc!.id}`)
      .set("Cookie", teacherA)
      .expect(204);
    await get(teacherA, doc!.id).expect(404);
  });

  it("exports a version as a file the teacher downloads, and the file goes with the document", async () => {
    const paper = await madePaper();
    const asked = await post(teacherA, `${paper.id}/exports`, { format: "pdf", variant: "answer_key", setCode: null })
      .expect(201); // prettier-ignore
    const file = asked.body as DocumentExport;
    expect(file).toMatchObject({ version: 1, format: "pdf", status: "pending",
                                 filename: "Force test - Answer key.pdf" }); // prettier-ignore
    expect(started.at(-1)).toEqual({ v: 1, orgId, requestedBy: teacherAId, exportId: file.id });
    await get(teacherA, `${paper.id}/exports/${file.id}/file`).expect(404); // not made yet

    // The render worker stored it; the workflow tells the API (finish_export).
    const key = `${orgId}/${paper.id}/${file.id}.pdf`;
    await s3.send(
      new PutObjectCommand({ Bucket: bucketName(base, "exports"), Key: key, Body: "%PDF-1.7 test" }),
    );
    await app.get(ExportDocuments).finish({ v: 1, orgId, exportId: file.id, s3Key: key, error: null });
    const listed = (await get(teacherA, `${paper.id}/exports`).expect(200)).body as DocumentExport[];
    expect(listed[0]).toMatchObject({ id: file.id, status: "done" });
    const downloaded = await get(teacherA, `${paper.id}/exports/${file.id}/file`).expect(200);
    expect(downloaded.headers["content-type"]).toBe("application/pdf");
    expect(downloaded.headers["content-disposition"]).toContain(
      "filename*=UTF-8''Force%20test%20-%20Answer%20key.pdf",
    );
    expect(downloaded.body.toString()).toBe("%PDF-1.7 test");
    await get(teacherB, `${paper.id}/exports/${file.id}/file`).expect(404); // another teacher's paper

    await request(app.getHttpServer())
      .delete(`/api/documents/${paper.id}`)
      .set("Cookie", teacherA)
      .expect(204);
    await expect(
      s3.send(new GetObjectCommand({ Bucket: bucketName(base, "exports"), Key: key })),
    ).rejects.toThrow(); // the file went with it
  });

  it("refuses an answer key for notes, and exports of a paper still being made", async () => {
    const [notes] = await owner.db
      .insert(schema.documents)
      .values({ orgId, kind: "notes", title: "Force notes", ownerId: teacherAId, spec: {}, content: {},
                currentVersion: 1 })
      .returning({ id: schema.documents.id }); // prettier-ignore
    await post(teacherA, `${notes!.id}/exports`, { format: "pdf", variant: "answer_key" }).expect(422);
    const [making] = await owner.db
      .insert(schema.documents)
      .values({ orgId, kind: "question_paper", title: "Making", ownerId: teacherAId, spec: {}, content: {} })
      .returning({ id: schema.documents.id });
    await post(teacherA, `${making!.id}/exports`, { format: "docx" }).expect(409);
  });
});
