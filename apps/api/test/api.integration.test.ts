/**
 * Boots the real API against the test database (local infrastructure must be up: `pnpm infra:up`) and checks
 * the behaviours other phases rely on: Better Auth sign-up/sign-in, the active organization, org-scoped data
 * through row-level security, and admin-only surfaces.
 */
import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  createDatabase,
  runMigrations,
  schema,
  syncLocalAppRolePassword,
  type DatabaseHandle,
} from "@vidyam/db";
import { eq as sqlEq, inArray as sqlIn } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AppModule } from "../src/app.module.js";
import { loadEnv } from "../src/config/env.js";

const base = loadEnv();
const testDbUrl = process.env.VIDYAM_TEST_DATABASE_URL!;
const testAdminUrl = process.env.VIDYAM_TEST_DATABASE_ADMIN_URL!;
const env = { ...base, VIDYAM_DATABASE_URL: testDbUrl };
const ORIGIN = env.VIDYAM_APP_URL;
const MAILPIT = "http://localhost:38181";

let app: INestApplication;
let owner: DatabaseHandle;
const orgA = crypto.randomUUID();
const orgB = crypto.randomUUID();
const email = `teacher-${crypto.randomUUID()}@vidyam.test`;
const forgetfulEmail = `forgetful-${crypto.randomUUID()}@vidyam.test`;
const password = "a-long-test-password-1";

async function signIn(): Promise<string[]> {
  const res = await request(app.getHttpServer())
    .post("/api/auth/sign-in/email")
    .set("Origin", ORIGIN)
    .send({ email, password })
    .expect(200);
  return res.get("Set-Cookie") ?? [];
}

beforeAll(async () => {
  await runMigrations(testAdminUrl);
  await syncLocalAppRolePassword(testAdminUrl, testDbUrl);
  owner = createDatabase(testAdminUrl, { max: 2 });

  app = await NestFactory.create(AppModule.forRoot(env), { bodyParser: false, logger: false });
  app.setGlobalPrefix("api");
  await app.init();

  await request(app.getHttpServer())
    .post("/api/auth/sign-up/email")
    .set("Origin", ORIGIN)
    .send({ email, password, name: "Test Teacher" })
    .expect(200);

  const [user] = await owner.db.select().from(schema.users).where(sqlEq(schema.users.email, email));
  await owner.db.insert(schema.organizations).values([
    { id: orgA, name: "Center A", slug: `a-${orgA}`, createdAt: new Date() },
    { id: orgB, name: "Center B", slug: `b-${orgB}`, createdAt: new Date() },
  ]);
  await owner.db
    .insert(schema.members)
    .values({ organizationId: orgA, userId: user!.id, role: "teacher", createdAt: new Date() });
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
  await owner?.db.delete(schema.users).where(sqlIn(schema.users.email, [email, forgetfulEmail]));
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

  it("keeps the queue dashboard for platform admins only", async () => {
    await request(app.getHttpServer()).get("/api/admin/queues").expect(401);
    const cookies = await signIn();
    await request(app.getHttpServer()).get("/api/admin/queues").set("Cookie", cookies).expect(403);
  });

  it("resets a forgotten password from the emailed link", async () => {
    const server = app.getHttpServer();
    const newPassword = "a-brand-new-password-2";
    await request(server)
      .post("/api/auth/sign-up/email")
      .set("Origin", ORIGIN)
      .send({ email: forgetfulEmail, password, name: "Forgetful Teacher" })
      .expect(200);

    await request(server)
      .post("/api/auth/request-password-reset")
      .set("Origin", ORIGIN)
      .send({ email: forgetfulEmail, redirectTo: `${ORIGIN}/en/reset-password` })
      .expect(200);

    // The email is sent in the background (see better-auth.ts), so wait for it to land in Mailpit.
    const token = await vi.waitFor(
      async () => {
        const search = await fetch(`${MAILPIT}/api/v1/search?query=to:"${forgetfulEmail}"`);
        const id = ((await search.json()) as { messages: { ID: string }[] }).messages[0]?.ID;
        if (!id) throw new Error("reset email not delivered yet");
        const message = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { Text: string };
        return message.Text.match(/\/reset-password\/([^?\s]+)/)![1]!;
      },
      { timeout: 10_000, interval: 200 },
    );

    await request(server)
      .post("/api/auth/reset-password")
      .set("Origin", ORIGIN)
      .send({ newPassword, token })
      .expect(200);
    await request(server)
      .post("/api/auth/sign-in/email")
      .set("Origin", ORIGIN)
      .send({ email: forgetfulEmail, password })
      .expect(401);
    await request(server)
      .post("/api/auth/sign-in/email")
      .set("Origin", ORIGIN)
      .send({ email: forgetfulEmail, password: newPassword })
      .expect(200);
  });
});
