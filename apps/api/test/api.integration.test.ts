/**
 * Boots the real API against the test database (local infrastructure must be up: `pnpm infra:up`) and checks
 * the behaviours other phases rely on: Better Auth sign-in, admin-managed logins, the active organization,
 * org-scoped data through row-level security, and admin-only surfaces.
 */
import "reflect-metadata";

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
const createdEmails = [email, adminEmail, outsiderEmail];
const password = "a-long-test-password-1";

async function signIn(as = email, withPassword = password): Promise<string[]> {
  const res = await request(app.getHttpServer())
    .post("/api/auth/sign-in/email")
    .set("Origin", ORIGIN)
    .send({ email: as, password: withPassword })
    .expect(200);
  return res.get("Set-Cookie") ?? [];
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
  const [teacherId, adminId, outsiderId] = [
    await createUser(email, "Test Teacher"),
    await createUser(adminEmail, "Test Admin"),
    await createUser(outsiderEmail, "Other Center Teacher"),
  ];

  await owner.db.insert(schema.organizations).values([
    { id: orgA, name: "Center A", slug: `a-${orgA}`, createdAt: new Date() },
    { id: orgB, name: "Center B", slug: `b-${orgB}`, createdAt: new Date() },
  ]);
  await owner.db.insert(schema.members).values([
    { organizationId: orgA, userId: teacherId, role: "teacher", createdAt: new Date() },
    { organizationId: orgA, userId: adminId, role: "admin", createdAt: new Date() },
    { organizationId: orgB, userId: outsiderId, role: "teacher", createdAt: new Date() },
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
    const [ready, scan, , busy] = await owner.db
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

    // Removing: not for teachers, not while a file is being read.
    const admin = await signIn(adminEmail);
    await request(server).delete(`/api/library/${scan!.id}`).set("Cookie", teacher).expect(403);
    await request(server).delete(`/api/library/${busy!.id}`).set("Cookie", admin).expect(409);
    await request(server).delete(`/api/library/${scan!.id}`).set("Cookie", admin).expect(204);
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
});
