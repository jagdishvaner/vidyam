/**
 * The dashboards' data (plan v3 step 30) against the test database: a teacher's own documents with the chat
 * each opens in, their own AI use against their budget (never a colleague's), and the coverage of the
 * center's material by subject, which only those who look after the library may see.
 */
import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AuthService } from "@thallesp/nestjs-better-auth";
import type { CoverageReport, DocumentListItem, MyUsage } from "@vidyam/contracts";
import {
  createDatabase,
  runMigrations,
  schema,
  syncLocalAppRolePassword,
  type DatabaseHandle,
} from "@vidyam/db";
import { inArray } from "drizzle-orm";
import { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { loadEnv } from "../src/config/env.js";
import type { Auth } from "../src/modules/identity/infrastructure/better-auth.js";

const base = loadEnv();
const testDbUrl = process.env.VIDYAM_TEST_DATABASE_URL!;
const testAdminUrl = process.env.VIDYAM_TEST_DATABASE_ADMIN_URL!;
const password = "a-long-test-password-1";
const orgId = crypto.randomUUID();
const emails = [`dash-teacher-${orgId}@vidyam.test`, `dash-admin-${orgId}@vidyam.test`];

let app: INestApplication;
let owner: DatabaseHandle;
let teacher: string[];
let admin: string[];
let teacherId: string;
let adminId: string;

async function signIn(email: string): Promise<string[]> {
  const res = await request(app.getHttpServer())
    .post("/api/auth/sign-in/email")
    .set("Origin", base.VIDYAM_APP_URL)
    .send({ email, password })
    .expect(200);
  return res.get("Set-Cookie") ?? [];
}

const get = (cookies: string[], path: string) =>
  request(app.getHttpServer()).get(`/api/${path}`).set("Cookie", cookies);

function call(userId: string | null, costUsd: string) {
  return {
    orgId, userId, task: "generate", provider: "stub", modelId: "stub", inputTokens: 10, cacheWriteTokens: 0,
    cacheReadTokens: 0, outputTokens: 10, costUsd, latencyMs: 5,
  }; // prettier-ignore
}

beforeAll(async () => {
  const redis = new Redis(base.VIDYAM_CACHE_REDIS_URL);
  const limits = await redis.keys("auth:*|/sign-in/email");
  if (limits.length) await redis.del(...limits);
  redis.disconnect();
  await runMigrations(testAdminUrl);
  await syncLocalAppRolePassword(testAdminUrl, testDbUrl);
  owner = createDatabase(testAdminUrl, { max: 2 });
  app = await NestFactory.create(AppModule.forRoot({ ...base, VIDYAM_DATABASE_URL: testDbUrl }), {
    bodyParser: false,
    logger: false,
  });
  app.setGlobalPrefix("api");
  await app.init();
  const auth = app.get<AuthService<Auth>>(AuthService);
  const ids = [];
  for (const email of emails) {
    ids.push((await auth.api.createUser({ body: { email, password, name: email.split("-")[1]! } })).user.id);
  }
  [teacherId, adminId] = ids as [string, string];
  await owner.db
    .insert(schema.organizations)
    .values({ id: orgId, name: "Dashboard center", slug: `dash-${orgId}`, createdAt: new Date() });
  await owner.db.insert(schema.members).values([
    { organizationId: orgId, userId: teacherId, role: "teacher", createdAt: new Date() },
    { organizationId: orgId, userId: adminId, role: "admin", createdAt: new Date() },
  ]);
  teacher = await signIn(emails[0]!);
  admin = await signIn(emails[1]!);
});

afterAll(async () => {
  await owner?.db.delete(schema.organizations).where(inArray(schema.organizations.id, [orgId]));
  await owner?.db.delete(schema.users).where(inArray(schema.users.email, emails));
  await app?.close();
  await owner?.pool.end();
});

describe("dashboard", () => {
  it("lists a teacher's own documents, newest first, each with the chat it opens in", async () => {
    const [chat] = await owner.db
      .insert(schema.chatSessions)
      .values({ orgId, userId: teacherId })
      .returning({ id: schema.chatSessions.id });
    const [older, newer] = await owner.db
      .insert(schema.documents)
      .values([
        { orgId, kind: "notes", title: "Older notes", ownerId: teacherId, currentVersion: 1,
          updatedAt: new Date(Date.now() - 60_000) },
        { orgId, kind: "question_paper", title: "Newer paper", ownerId: teacherId, currentVersion: 2 },
        { orgId, kind: "question_paper", title: "Someone else's", ownerId: adminId, currentVersion: 1 },
      ])
      .returning({ id: schema.documents.id }); // prettier-ignore
    await owner.db.insert(schema.generationRuns).values({
      orgId, documentId: newer!.id, sessionId: chat!.id, workflowId: `GeneratePaper:${newer!.id}`, spec: {},
    }); // prettier-ignore
    const listed = (await get(teacher, "documents?limit=10").expect(200)).body as DocumentListItem[];
    expect(listed.map((doc) => [doc.title, doc.chatId])).toEqual([
      ["Newer paper", chat!.id],
      ["Older notes", null],
    ]);
    expect(listed[0]).toMatchObject({ id: newer!.id, kind: "question_paper", currentVersion: 2 });
    expect(older).toBeDefined();
  });

  it("shows a teacher their own spend against their budget, and whether the center's is used up", async () => {
    await owner.db
      .insert(schema.llmCalls)
      .values([call(teacherId, "0.25"), call(teacherId, "0.5"), call(adminId, "3")]);
    await owner.db.insert(schema.quotas).values({ orgId, userId: teacherId, monthlyLimitUsd: "10.00" });
    const mine = (await get(teacher, "me/usage").expect(200)).body as MyUsage;
    expect(mine).toMatchObject({ calls: 2, costUsd: 0.75, budgetUsd: 10, centerExhausted: false });
    expect(mine.month).toMatch(/^\d{4}-\d{2}$/);

    await owner.db.insert(schema.quotas).values({ orgId, userId: null, monthlyLimitUsd: "3.50" });
    expect((await get(teacher, "me/usage").expect(200)).body.centerExhausted).toBe(true); // 3.75 spent
  });

  it("shows coverage by subject to those who look after the library, and not to teachers", async () => {
    const [subject] = await owner.db
      .insert(schema.taxonomyNodes)
      .values({ orgId, level: "subject", code: "physics", nameEn: "Physics", nameHi: "भौतिकी" })
      .returning({ id: schema.taxonomyNodes.id });
    const chapters = await owner.db
      .insert(schema.taxonomyNodes)
      .values(
        ["motion", "light"].map((code) => ({
          orgId,
          parentId: subject!.id,
          level: "chapter" as const,
          code,
          nameEn: code,
        })),
      ) // prettier-ignore
      .returning({ id: schema.taxonomyNodes.id });
    const [source] = await owner.db
      .insert(schema.sources)
      .values({
        orgId,
        sha256: crypto.randomUUID(),
        filename: "motion.pdf",
        s3Key: "x",
        mimeType: "application/pdf",
        sizeBytes: 1,
        kind: "notes",
        licence: "own",
      }) // prettier-ignore
      .returning({ id: schema.sources.id });
    const chunks = await owner.db
      .insert(schema.chunks)
      .values(
        [0, 1].map((position) => ({
          orgId,
          sourceId: source!.id,
          position,
          text: "गति",
          language: "hi" as const,
          tokenCount: 1,
        })),
      ) // prettier-ignore
      .returning({ id: schema.chunks.id });
    await owner.db.insert(schema.chunkTags).values(
      chunks.map((chunk) => ({
        orgId,
        chunkId: chunk.id,
        nodeId: chapters[0]!.id,
        method: "manifest" as const,
      })),
    );
    await get(teacher, "dashboard/coverage").expect(403);
    const report = (await get(admin, "dashboard/coverage").expect(200)).body as CoverageReport;
    expect(report.subjects).toEqual([
      { nodeId: subject!.id, name: { en: "Physics", hi: "भौतिकी" }, chapters: 2, chaptersWithMaterial: 1,
        passages: 2, questions: 0 },
    ]); // prettier-ignore
  });
});
