/**
 * Boots the real API against the test database (local infrastructure must be up: `pnpm infra:up`) and checks
 * the behaviours other phases rely on: Better Auth sign-in, admin-managed logins, the active organization,
 * org-scoped data through row-level security, and admin-only surfaces.
 */
import "reflect-metadata";

import { readFileSync } from "node:fs";
import path from "node:path";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AuthService } from "@thallesp/nestjs-better-auth";
import {
  createDatabase,
  runMigrations,
  schema,
  syncLocalAppRolePassword,
  type DatabaseHandle,
} from "@vidyam/db";
import { eq as sqlEq, inArray as sqlIn } from "drizzle-orm";
import { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { loadEnv } from "../src/config/env.js";
import type { Auth } from "../src/modules/identity/infrastructure/better-auth.js";

const base = loadEnv();
const testDbUrl = process.env.VIDYAM_TEST_DATABASE_URL!;
const testAdminUrl = process.env.VIDYAM_TEST_DATABASE_ADMIN_URL!;
const env = { ...base, VIDYAM_DATABASE_URL: testDbUrl };
const ORIGIN = env.VIDYAM_APP_URL;

let app: INestApplication;
let owner: DatabaseHandle;
const orgA = crypto.randomUUID();
const orgB = crypto.randomUUID();
const testEmail = (who: string) => `${who}-${crypto.randomUUID()}@vidyam.test`;
const email = testEmail("teacher");
const adminEmail = testEmail("admin");
const outsiderEmail = testEmail("outsider");
const operatorEmail = testEmail("operator");
const createdEmails = [email, adminEmail, outsiderEmail, operatorEmail];
const password = "a-long-test-password-1";

async function signIn(as = email, withPassword = password): Promise<string[]> {
  const res = await request(app.getHttpServer())
    .post("/api/auth/sign-in/email")
    .set("Origin", ORIGIN)
    .send({ email: as, password: withPassword })
    .expect(200);
  return res.get("Set-Cookie") ?? [];
}

/**
 * One session per login for tests that only read or change data, so the suite stays under the real sign-in
 * rate limit. Tests about passwords and sign-out use `signIn` for fresh sessions.
 */
const sessions = new Map<string, Promise<string[]>>();
function sessionFor(as = email): Promise<string[]> {
  if (!sessions.has(as)) sessions.set(as, signIn(as));
  return sessions.get(as)!;
}

/** The suite signs in ~20 times; counters left by a run a minute ago would trip the real sign-in limit. */
async function resetSignInRateLimits() {
  const redis = new Redis(env.VIDYAM_CACHE_REDIS_URL);
  const keys = await redis.keys("auth:*|/sign-in/email");
  if (keys.length) await redis.del(...keys);
  redis.disconnect();
}

beforeAll(async () => {
  await resetSignInRateLimits();
  await runMigrations(testAdminUrl);
  await syncLocalAppRolePassword(testAdminUrl, testDbUrl);
  owner = createDatabase(testAdminUrl, { max: 2 });

  app = await NestFactory.create(AppModule.forRoot(env), { bodyParser: false, logger: false });
  app.setGlobalPrefix("api");
  await app.init();

  // Public sign-up is off; logins are created server-side, as center admins do through /api/members.
  const auth = app.get<AuthService<Auth>>(AuthService);
  const createUser = async (userEmail: string, name: string) =>
    (await auth.api.createUser({ body: { email: userEmail, password, name } })).user.id;
  const [teacherId, adminId, outsiderId, operatorId] = [
    await createUser(email, "Test Teacher"),
    await createUser(adminEmail, "Test Admin"),
    await createUser(outsiderEmail, "Other Center Teacher"),
    await createUser(operatorEmail, "Test Content Operator"),
  ];

  await owner.db.insert(schema.organizations).values([
    { id: orgA, name: "Center A", slug: `a-${orgA}`, createdAt: new Date() },
    { id: orgB, name: "Center B", slug: `b-${orgB}`, createdAt: new Date() },
  ]);
  await owner.db.insert(schema.members).values([
    { organizationId: orgA, userId: teacherId, role: "teacher", createdAt: new Date() },
    { organizationId: orgA, userId: adminId, role: "admin", createdAt: new Date() },
    { organizationId: orgB, userId: outsiderId, role: "teacher", createdAt: new Date() },
    { organizationId: orgA, userId: operatorId, role: "content_operator", createdAt: new Date() },
  ]);
  const source = (orgId: string) => ({
    orgId,
    sha256: crypto.randomUUID(),
    filename: "book.pdf",
    s3Key: "raw/book.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1,
    kind: "book" as const,
    licence: "own" as const,
  });
  await owner.db.insert(schema.sources).values([source(orgA), source(orgB), source(orgB)]);
});

afterAll(async () => {
  await owner?.db.delete(schema.organizations).where(sqlIn(schema.organizations.id, [orgA, orgB]));
  await owner?.db.delete(schema.users).where(sqlIn(schema.users.email, createdEmails));
  await app?.close();
  await owner?.pool.end();
});

describe("API", () => {
  it("liveness is public; everything else needs a session", async () => {
    await request(app.getHttpServer()).get("/api/health").expect(200, { ok: true });
    await request(app.getHttpServer()).get("/api/me").expect(401);
    await request(app.getHttpServer()).get("/api/dashboard/summary").expect(401);
  });

  it("rejects a wrong password", async () => {
    await request(app.getHttpServer())
      .post("/api/auth/sign-in/email")
      .set("Origin", ORIGIN)
      .send({ email, password: "not-the-password" })
      .expect(401);
  });

  it("signs in to the user's organization with their role", async () => {
    const cookies = await signIn();
    const res = await request(app.getHttpServer()).get("/api/me").set("Cookie", cookies).expect(200);
    expect(res.body).toMatchObject({
      email,
      platformRole: null,
      orgRole: "teacher",
      organization: { id: orgA, name: "Center A" },
    });
  });

  it("counts only the active organization's data (row-level security)", async () => {
    const cookies = await signIn();
    const res = await request(app.getHttpServer()).get("/api/dashboard/summary").set("Cookie", cookies);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sources: 1, questions: 0, documents: 0 });
  });

  it("reports Temporal, the workflow engine, among the API's healthy dependencies", async () => {
    const cookies = await signIn();
    const res = await request(app.getHttpServer())
      .get("/api/system/status")
      .set("Cookie", cookies)
      .expect(200);
    const api = res.body.services.find((s: { service: string }) => s.service === "api");
    expect(api.dependencies).toContainEqual(
      expect.objectContaining({ name: "temporal", ok: true, detail: "namespace vidyam ready" }),
    );
  });

  it("has no public sign-up", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/sign-up/email")
      .set("Origin", ORIGIN)
      .send({ email: testEmail("stranger"), password, name: "Stranger" });
    expect(res.status).toBe(400);
  });

  it("lets a center admin add a member, who can then sign in", async () => {
    const server = app.getHttpServer();
    const member = { name: "Asha Sharma", email: testEmail("added"), role: "reviewer", password };
    createdEmails.push(member.email);

    const adminCookies = await signIn(adminEmail);
    const teacherCookies = await signIn();
    await request(server).post("/api/members").set("Cookie", teacherCookies).send(member).expect(403);
    const res = await request(server)
      .post("/api/members")
      .set("Cookie", adminCookies)
      .send(member)
      .expect(201);
    expect(res.body).toEqual({ userId: expect.any(String) });
    await request(server).post("/api/members").set("Cookie", adminCookies).send(member).expect(409);
    await request(server)
      .post("/api/members")
      .set("Cookie", adminCookies)
      .send({ ...member, email: testEmail("short"), password: "short" })
      .expect(400);

    const memberCookies = await signIn(member.email);
    const me = await request(server).get("/api/me").set("Cookie", memberCookies).expect(200);
    expect(me.body).toMatchObject({ name: member.name, orgRole: "reviewer", organization: { id: orgA } });
  });

  it("lets a center admin set a member's password, which signs the member out", async () => {
    const server = app.getHttpServer();
    const newPassword = "a-brand-new-password-2";
    const adminCookies = await signIn(adminEmail);
    const teacherCookies = await signIn();
    const { body: teacher } = await request(server).get("/api/me").set("Cookie", teacherCookies);
    const [outsider] = await owner.db
      .select()
      .from(schema.users)
      .where(sqlEq(schema.users.email, outsiderEmail));

    await request(server)
      .put(`/api/members/${outsider!.id}/password`)
      .set("Cookie", adminCookies)
      .send({ password: newPassword })
      .expect(404);
    await request(server)
      .put(`/api/members/${teacher.id}/password`)
      .set("Cookie", teacherCookies)
      .send({ password: newPassword })
      .expect(403);
    await request(server)
      .put(`/api/members/${teacher.id}/password`)
      .set("Cookie", adminCookies)
      .send({ password: newPassword })
      .expect(204);

    await request(server).get("/api/me").set("Cookie", teacherCookies).expect(401);
    await request(server)
      .post("/api/auth/sign-in/email")
      .set("Origin", ORIGIN)
      .send({ email, password })
      .expect(401);
    await signIn(email, newPassword);
    // Restore the shared test login for anything that runs after this test.
    await request(server)
      .put(`/api/members/${teacher.id}/password`)
      .set("Cookie", adminCookies)
      .send({ password })
      .expect(204);
  });

  it("lets a center admin remove someone who left, ending their access at once", async () => {
    const server = app.getHttpServer();
    const leaver = { name: "Leaving Teacher", email: testEmail("leaver"), role: "teacher", password };
    createdEmails.push(leaver.email);
    const adminCookies = await signIn(adminEmail);
    const teacherCookies = await signIn();
    const { body: added } = await request(server)
      .post("/api/members")
      .set("Cookie", adminCookies)
      .send(leaver)
      .expect(201);
    const leaverCookies = await signIn(leaver.email);
    const { body: admin } = await request(server).get("/api/me").set("Cookie", adminCookies);
    const [outsider] = await owner.db
      .select()
      .from(schema.users)
      .where(sqlEq(schema.users.email, outsiderEmail));

    await request(server).delete(`/api/members/${added.userId}`).set("Cookie", teacherCookies).expect(403);
    await request(server).delete(`/api/members/${admin.id}`).set("Cookie", adminCookies).expect(422);
    await request(server).delete(`/api/members/${outsider!.id}`).set("Cookie", adminCookies).expect(404);
    await request(server).delete(`/api/members/${added.userId}`).set("Cookie", adminCookies).expect(204);

    await request(server).get("/api/me").set("Cookie", leaverCookies).expect(401);
    await request(server)
      .post("/api/auth/sign-in/email")
      .set("Origin", ORIGIN)
      .send({ email: leaver.email, password })
      .expect(401);
    // In no other center, so the login itself is gone and the email can be used again.
    expect(await owner.db.$count(schema.users, sqlEq(schema.users.id, added.userId))).toBe(0);
  });

  it("shows a center's library with each file's reading state, and only its own files", async () => {
    const server = app.getHttpServer();
    const file = (filename: string, progress: Partial<typeof schema.sources.$inferInsert>) => ({
      orgId: orgA,
      sha256: crypto.randomUUID(),
      filename,
      s3Key: `org/${orgA}/originals/${filename}`,
      mimeType: "application/pdf",
      sizeBytes: 1,
      kind: "notes" as const,
      licence: "own" as const,
      ...progress,
    });
    const [ready, scan, broken, busy] = await owner.db
      .insert(schema.sources)
      .values([
        file("a-book.pdf", { stage: "chunked", status: "done", pageCount: 2, meta: { exam: "rpsc" } }),
        file("b-scan.pdf", { stage: "chunked", status: "pending", pageCount: 1 }),
        file("c-broken.pdf", { stage: "parsed", status: "failed", error: "PDF can't be opened" }),
        file("d-busy.pdf", { stage: "parsed", status: "running" }),
      ])
      .returning({ id: schema.sources.id });
    await owner.db.insert(schema.pages).values([
      {
        orgId: orgA,
        sourceId: ready!.id,
        pageNo: 1,
        method: "legacy_font",
        contentMd: "भारत",
        confidence: 1,
      },
      { orgId: orgA, sourceId: ready!.id, pageNo: 2, method: "vision_ocr", meta: { awaitingOcr: true } },
      { orgId: orgA, sourceId: scan!.id, pageNo: 1, method: "vision_ocr", meta: { awaitingOcr: true } },
    ]);
    const section = (position: number, text: string) => ({
      orgId: orgA,
      sourceId: ready!.id,
      position,
      text,
      language: "hi" as const,
      tokenCount: 3,
      pageStart: 1,
      pageEnd: 1,
    });
    await owner.db.insert(schema.chunks).values([section(1, "दूसरा भाग"), section(0, "भारत का संविधान")]);

    const teacher = await signIn();
    const get = (path: string, cookies = teacher) => request(server).get(path).set("Cookie", cookies);
    // The source added in beforeAll is still waiting to be picked up.
    expect((await get("/api/library/summary").expect(200)).body).toEqual({
      files: 5,
      sections: 2,
      ocrPages: 2,
      failed: 1,
      inProgress: 2,
    });
    const all = (await get("/api/library").expect(200)).body;
    expect(all.total).toBe(5);
    expect(all.items.map((s: { filename: string; state: string }) => [s.filename, s.state])).toEqual([
      ["a-book.pdf", "ready"],
      ["b-scan.pdf", "waiting_for_ocr"],
      ["c-broken.pdf", "failed"],
      ["d-busy.pdf", "reading"],
      ["book.pdf", "queued"],
    ]);
    expect(all.items[0]).toMatchObject({ sections: 2, ocrPages: 1, pages: 2, meta: { exam: "rpsc" } });
    const names = async (query: string) =>
      (await get(`/api/library?${query}`).expect(200)).body.items.map(
        (s: { filename: string }) => s.filename,
      );
    expect(await names("show=ready")).toEqual(["a-book.pdf"]);
    expect(await names("show=needs_ocr")).toEqual(["a-book.pdf", "b-scan.pdf"]);
    expect(await names("show=in_progress")).toEqual(["d-busy.pdf", "book.pdf"]);
    expect(await names("show=failed")).toEqual(["c-broken.pdf"]);
    expect(await names("search=SCAN")).toEqual(["b-scan.pdf"]);
    await get("/api/library?show=everything").expect(400);

    const detail = (await get(`/api/library/${ready!.id}`).expect(200)).body;
    expect(detail.pageReadings).toEqual([
      { pageNo: 1, state: "converted", confidence: 1, note: null },
      { pageNo: 2, state: "waiting_for_ocr", confidence: null, note: null },
    ]);
    expect(detail.sectionPreview.map((s: { text: string }) => s.text)).toEqual([
      "भारत का संविधान",
      "दूसरा भाग",
    ]);

    // Another center sees none of it.
    const outsider = await signIn(outsiderEmail);
    await get(`/api/library/${ready!.id}`, outsider).expect(404);
    expect((await get("/api/library/summary", outsider).expect(200)).body.files).toBe(2);

    // Removing (library:remove): admins and content operators, not teachers, and not while a file is being read.
    const admin = await signIn(adminEmail);
    const operator = await signIn(operatorEmail);
    await request(server).delete(`/api/library/${scan!.id}`).set("Cookie", teacher).expect(403);
    await request(server).delete(`/api/library/${busy!.id}`).set("Cookie", admin).expect(409);
    await request(server).delete(`/api/library/${scan!.id}`).set("Cookie", admin).expect(204);
    await request(server).delete(`/api/library/${broken!.id}`).set("Cookie", operator).expect(204);
    await get(`/api/library/${scan!.id}`).expect(404);
    expect(await owner.db.$count(schema.pages, sqlEq(schema.pages.sourceId, scan!.id))).toBe(0);
    // Its vectors are queued for deletion, in the same transaction (the API never calls Qdrant).
    expect(
      await owner.db
        .select({ entity: schema.indexOutbox.entity, op: schema.indexOutbox.op })
        .from(schema.indexOutbox)
        .where(sqlEq(schema.indexOutbox.entityId, scan!.id)),
    ).toEqual([{ entity: "source", op: "delete" }]);
  });

  it("lets a center admin set a member's role, subjects and AI budget", async () => {
    const server = app.getHttpServer();
    const [science, motion, otherScience] = await owner.db
      .insert(schema.taxonomyNodes)
      .values([
        { orgId: orgA, level: "subject" as const, code: "science", nameEn: "Science", nameHi: "विज्ञान" },
        { orgId: orgA, level: "subject" as const, code: "motion_chapter", nameEn: "Motion", nameHi: "गति" },
        { orgId: orgB, level: "subject" as const, code: "science", nameEn: "Science", nameHi: "विज्ञान" },
      ])
      .returning({ id: schema.taxonomyNodes.id });
    // A chapter, not a subject: re-parent the second node under the first.
    await owner.db
      .update(schema.taxonomyNodes)
      .set({ level: "chapter", parentId: science!.id })
      .where(sqlEq(schema.taxonomyNodes.id, motion!.id));

    const [admin, teacher] = [await sessionFor(adminEmail), await sessionFor()];
    await request(server).get("/api/staff").set("Cookie", teacher).expect(403);
    const before = (await request(server).get("/api/staff").set("Cookie", admin).expect(200)).body;
    expect(before.subjects).toEqual([
      { nodeId: science!.id, code: "science", nameEn: "Science", nameHi: "विज्ञान" },
    ]);
    const asha = before.members.find((m: { email: string }) => m.email === email);
    const self = before.members.find((m: { email: string }) => m.email === adminEmail);
    expect(asha).toMatchObject({
      role: "teacher",
      subjects: [],
      monthlyBudgetUsd: null,
      spentThisMonthUsd: 0,
    });
    await owner.db.insert(schema.llmCalls).values({
      orgId: orgA,
      userId: asha.userId,
      task: "chat_qa",
      provider: "stub",
      modelId: "stub",
      inputTokens: 10,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 10,
      costUsd: "0.250000",
      latencyMs: 5,
    });

    const put = (userId: string, body: object, cookies = admin) =>
      request(server).put(`/api/staff/${userId}`).set("Cookie", cookies).send(body);
    const change = {
      role: "reviewer",
      subjects: [{ nodeId: science!.id, isHead: true }],
      monthlyBudgetUsd: 25,
    };
    await put(asha.userId, change).expect(204);
    const after = (await request(server).get("/api/staff").set("Cookie", admin).expect(200)).body;
    expect(after.members.find((m: { email: string }) => m.email === email)).toMatchObject({
      role: "reviewer",
      subjects: [{ nodeId: science!.id, code: "science", isHead: true }],
      monthlyBudgetUsd: 25,
      spentThisMonthUsd: 0.25,
    });

    // Chapters and another center's subjects can't be assigned; an admin can't demote themselves.
    await put(asha.userId, { ...change, subjects: [{ nodeId: motion!.id, isHead: false }] }).expect(422);
    await put(asha.userId, { ...change, subjects: [{ nodeId: otherScience!.id, isHead: false }] }).expect(
      422,
    );
    await put(self.userId, { role: "teacher", subjects: [], monthlyBudgetUsd: null }).expect(422);
    await put(asha.userId, { ...change, monthlyBudgetUsd: -1 }).expect(400);

    // Back to a plain teacher with no personal budget, as the other tests expect.
    await put(asha.userId, { role: "teacher", subjects: [], monthlyBudgetUsd: null }).expect(204);
    expect(await owner.db.$count(schema.quotas, sqlEq(schema.quotas.userId, asha.userId))).toBe(0);
  });

  it("imports a syllabus and exam papers by code path, and lets admins edit the tree", async () => {
    const server = app.getHttpServer();
    const pack = path.join(import.meta.dirname, "..", "..", "..", "fixtures", "demo-pack", "catalog");
    const syllabus = JSON.parse(readFileSync(path.join(pack, "syllabus-science.json"), "utf8"));
    const examPapers = JSON.parse(readFileSync(path.join(pack, "exams.json"), "utf8"));
    const [admin, teacher] = [await sessionFor(adminEmail), await sessionFor()];
    const post = (url: string, body: object, cookies = admin) =>
      request(server).post(url).set("Cookie", cookies).send(body);

    await post("/api/syllabus/import", syllabus, teacher).expect(403);
    // An earlier test made a bare "science" subject: the import adds its aliases and fills in the tree.
    expect((await post("/api/syllabus/import", syllabus).expect(200)).body).toEqual({
      created: 54,
      updated: 1,
      unchanged: 0,
    });
    expect((await post("/api/syllabus/import", syllabus).expect(200)).body).toEqual({
      created: 0,
      updated: 0,
      unchanged: 55,
    });

    // Exam papers name nodes by path; unknown paths are refused with the path in the message.
    const exam = examPapers[0];
    const missing = { ...exam, syllabus: [{ node: "science/astronomy" }] };
    const refused = await post("/api/exams/import", { exams: [missing] }).expect(422);
    expect(refused.body.message).toContain("science/astronomy");
    expect((await post("/api/exams/import", { exams: examPapers }).expect(200)).body).toMatchObject({
      created: 1,
    });
    const papers = (await request(server).get("/api/exams").set("Cookie", teacher).expect(200)).body;
    expect(papers).toEqual([
      expect.objectContaining({
        code: "rpsc_2g_p2_science",
        family: "rpsc_2nd_grade",
        syllabus: [
          expect.objectContaining({ path: "science/biology", weightage: expect.closeTo(0.3, 5) }),
          expect.objectContaining({ path: "science/chemistry" }),
          expect.objectContaining({ path: "science/physics", weightage: expect.closeTo(0.4, 5) }),
        ],
      }),
    ]);

    // Teachers read the tree (the chat's pickers need it); admins edit it.
    const overview = (await request(server).get("/api/syllabus").set("Cookie", teacher).expect(200)).body;
    const science = overview.subjects.find((s: { code: string }) => s.code === "science");
    expect(science.descendants).toBe(55); // the pack's 54, plus the chapter the staff test made
    const tree = (
      await request(server).get(`/api/syllabus/subjects/${science.id}`).set("Cookie", teacher).expect(200)
    ).body;
    const motion = tree.nodes.find((n: { path: string }) => n.path === "science/physics/motion");
    expect(motion).toMatchObject({ level: "chapter", nameHi: "गति" });
    const child = { parentId: motion.id, code: "relative_motion", level: "topic", nameEn: "Relative Motion" };
    const fields = { nameHi: "सापेक्ष गति", aliases: ["sapeksh gati"], objectives: [] };
    const created = (await post("/api/syllabus/nodes", { ...child, ...fields }).expect(201)).body;
    expect(created.path).toBe("science/physics/motion/relative_motion");
    await post("/api/syllabus/nodes", { ...child, ...fields }).expect(409);
    await post("/api/syllabus/nodes", { ...child, ...fields, code: "units", level: "unit" }).expect(422);
    const retired = await request(server)
      .put(`/api/syllabus/nodes/${created.id}`)
      .set("Cookie", admin)
      .send({ ...fields, nameEn: "Relative motion", isActive: false })
      .expect(200);
    expect(retired.body).toMatchObject({
      nameEn: "Relative motion",
      isActive: false,
      code: "relative_motion",
    });

    await request(server).delete(`/api/exams/${papers[0].id}`).set("Cookie", teacher).expect(403);
    await request(server).delete(`/api/exams/${papers[0].id}`).set("Cookie", admin).expect(204);
  });

  it("keeps versioned paper patterns for an exam paper, checked against its syllabus", async () => {
    const server = app.getHttpServer();
    const pack = path.join(import.meta.dirname, "..", "..", "..", "fixtures", "demo-pack", "catalog");
    const read = (file: string) => JSON.parse(readFileSync(path.join(pack, file), "utf8"));
    const [admin, teacher] = [await sessionFor(adminEmail), await sessionFor()];
    const send = (method: "post" | "put" | "delete", url: string, body?: object, cookies = admin) =>
      request(server)[method](url).set("Cookie", cookies).send(body);
    // The syllabus test imported the demo tree; the exam paper was deleted there, so bring it back.
    await send("post", "/api/exams/import", { exams: read("exams.json") }).expect(200);

    const blueprints = read("blueprints.json");
    await send("post", "/api/patterns/import", { blueprints }, teacher).expect(403);
    expect((await send("post", "/api/patterns/import", { blueprints }).expect(200)).body).toEqual({
      created: 3,
      updated: 0,
      unchanged: 0,
    });
    expect((await send("post", "/api/patterns/import", { blueprints }).expect(200)).body).toMatchObject({
      unchanged: 3,
    });

    const list = (await request(server).get("/api/patterns").set("Cookie", teacher).expect(200)).body;
    const full = list.find((p: { name: string }) => p.name === "Full paper");
    expect(full).toMatchObject({
      examCode: "rpsc_2g_p2_science",
      version: 1,
      totalQuestions: 150,
      totalMarks: 300,
    });

    // Editing makes version 2; papers made from version 1 keep it, but it leaves the list.
    const chapterTest = list.find((p: { name: string }) => p.name === "Chapter test");
    const shorter = { ...chapterTest.blueprint, durationMinutes: 25 };
    const edited = (
      await send("put", `/api/patterns/${chapterTest.id}`, {
        examId: chapterTest.examId,
        name: "Chapter test",
        blueprint: shorter,
      }).expect(200)
    ).body;
    expect(edited).toMatchObject({ version: 2, blueprint: { durationMinutes: 25 } });
    const after = (
      await request(server).get(`/api/patterns?examId=${chapterTest.examId}`).set("Cookie", admin)
    ).body;
    expect(after.map((p: { id: string }) => p.id)).not.toContain(chapterTest.id);
    expect(after).toHaveLength(3);

    // A section may only draw from the paper's own syllabus.
    const physicsOnly = {
      ...shorter,
      sections: [{ ...shorter.sections[0], scope: ["science/physics/motion"] }],
    };
    await send("post", "/api/patterns", {
      examId: full.examId,
      name: "Motion test",
      blueprint: physicsOnly,
    }).expect(201);
    const outside = { ...physicsOnly, sections: [{ ...shorter.sections[0], scope: ["science/astronomy"] }] };
    await send("post", "/api/patterns", { examId: full.examId, name: "Stars", blueprint: outside }).expect(
      422,
    );
    await send("post", "/api/patterns", {
      examId: full.examId,
      name: "Full paper",
      blueprint: shorter,
    }).expect(409);

    await send("delete", `/api/patterns/${edited.id}`, undefined, teacher).expect(403);
    await send("delete", `/api/patterns/${edited.id}`).expect(204);
    await send("delete", `/api/patterns/${edited.id}`).expect(404);
  });

  it("keeps the center's branding, AI policy and logo, editable only by admins", async () => {
    const server = app.getHttpServer();
    const [admin, teacher] = [await sessionFor(adminEmail), await sessionFor()];
    const get = (url: string, cookies = teacher) => request(server).get(url).set("Cookie", cookies);
    const put = (url: string, body: object, cookies = admin) =>
      request(server).put(url).set("Cookie", cookies).send(body);

    // Until an admin saves anything, exports would use the center's name.
    expect((await get("/api/center").expect(200)).body).toMatchObject({
      organization: { id: orgA, name: "Center A" },
      branding: { name: { en: "Center A" }, logoKey: null },
      logoUrl: null,
      aiPolicy: { allowedModelIds: [], requireCrossProviderCheck: true, defaultSourcing: "bank_first" },
    });
    const branding = {
      name: { en: "Center A Coaching", hi: "सेंटर ए कोचिंग" },
      headerLines: { hi: "जयपुर", en: "Jaipur" },
      footer: null,
      defaultInstructions: null,
    };
    await put("/api/center/branding", branding, teacher).expect(403);
    await put("/api/center/branding", branding).expect(204);
    expect((await get("/api/center").expect(200)).body.branding).toMatchObject(branding);

    await put("/api/center/ai-policy", { allowedModelIds: ["not-a-model"] }).expect(422);
    await put("/api/center/ai-policy", { allowedModelIds: [], defaultSourcing: "fresh_only" }).expect(204);
    expect((await get("/api/center").expect(200)).body.aiPolicy.defaultSourcing).toBe("fresh_only");

    // The logo's type comes from its bytes; an HTML file renamed .png is refused.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const upload = (bytes: Buffer, name: string) =>
      request(server).post("/api/center/logo").set("Cookie", admin).attach("logo", bytes, name);
    await upload(Buffer.from("<html><script>alert(1)</script></html>"), "logo.png").expect(422);
    const { logoUrl } = (await upload(png, "logo.png").expect(200)).body;
    expect(logoUrl).toMatch(/^\/api\/center\/logo\?v=[0-9a-f]{16}$/);
    const served = await get("/api/center/logo").expect(200);
    expect(served.headers["content-type"]).toBe("image/png");
    expect(Buffer.compare(served.body as Buffer, png)).toBe(0);

    await request(server).delete("/api/center/logo").set("Cookie", teacher).expect(403);
    await request(server).delete("/api/center/logo").set("Cookie", admin).expect(204);
    await get("/api/center/logo").expect(404);
  });

  it("shows admins the model registry and task routes, and lets a center choose its own routes", async () => {
    const server = app.getHttpServer();
    const [admin, teacher] = [await sessionFor(adminEmail), await sessionFor()];
    // The registry is global; these test models are removed again at the end.
    const ids = [`test-big-${orgA}`, `test-small-${orgA}`];
    const testModel = (id: string) => ({
      id,
      provider: "stub" as const,
      apiModel: id,
      displayName: id,
      prices: { input: 1, output: 2 },
      contextWindow: 100_000,
      maxOutputTokens: 8_000,
    });
    await owner.db.insert(schema.llmModels).values(ids.map(testModel)).onConflictDoNothing();
    try {
      await request(server).get("/api/ai").set("Cookie", teacher).expect(403);
      const overview = (await request(server).get("/api/ai").set("Cookie", admin).expect(200)).body;
      expect(overview.canEditModels).toBe(false);
      expect(overview.models.map((m: { id: string }) => m.id)).toEqual(expect.arrayContaining(ids));
      expect(overview.routes).toHaveLength(16);

      // A center admin (not the platform admin) can't change the shared registry.
      await request(server)
        .put(`/api/ai/models/${ids[0]}`)
        .set("Cookie", admin)
        .send({ enabled: false, teacherSelectable: false })
        .expect(403);

      const route = { modelId: ids[0], effort: "high", maxTokens: 32_000, fallbackModelId: ids[1] };
      await request(server).put("/api/ai/routes/generate").set("Cookie", admin).send(route).expect(204);
      await request(server)
        .put("/api/ai/routes/generate")
        .set("Cookie", admin)
        .send({ ...route, modelId: "no-such-model" })
        .expect(422);
      const routes = (await request(server).get("/api/ai").set("Cookie", admin)).body.routes;
      expect(routes.find((r: { task: string }) => r.task === "generate")).toEqual({
        task: "generate",
        ...route,
        source: "center",
      });

      await request(server).delete("/api/ai/routes/generate").set("Cookie", admin).expect(204);
      const after = (await request(server).get("/api/ai").set("Cookie", admin)).body.routes;
      expect(after.find((r: { task: string }) => r.task === "generate").source).not.toBe("center");
    } finally {
      await owner.db.delete(schema.taskRoutes).where(sqlEq(schema.taskRoutes.orgId, orgA));
      await owner.db.delete(schema.llmModels).where(sqlIn(schema.llmModels.id, ids));
    }
  });

  it("lets center admins read prompts but leaves writing them to the platform admin", async () => {
    const server = app.getHttpServer();
    const [admin, teacher] = [await sessionFor(adminEmail), await sessionFor()];
    await request(server).get("/api/prompts").set("Cookie", teacher).expect(403);
    const overview = (await request(server).get("/api/prompts").set("Cookie", admin).expect(200)).body;
    expect(overview.canEdit).toBe(false);
    const prompt = { name: "chat_title", modelFamily: "any", body: "Give this chat a short title, please." };
    await request(server).post("/api/prompts").set("Cookie", admin).send(prompt).expect(403);
  });
});
