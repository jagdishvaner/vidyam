/**
 * Recent problems (plan v3 step 31) against the test database: what failed in the last day, from the rows the
 * services already write, with AI calls failing the same way counted as one; older or successful work is
 * left out, and only admins may look.
 */
import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AuthService } from "@thallesp/nestjs-better-auth";
import type { ProblemReport } from "@vidyam/contracts";
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
import { PROBLEM_STORE, type ProblemStore } from "../src/modules/system/application/list-problems.js";

const base = loadEnv();
const testDbUrl = process.env.VIDYAM_TEST_DATABASE_URL!;
const testAdminUrl = process.env.VIDYAM_TEST_DATABASE_ADMIN_URL!;
const password = "a-long-test-password-1";
const orgId = crypto.randomUUID();
const emails = [`problems-teacher-${orgId}@vidyam.test`, `problems-admin-${orgId}@vidyam.test`];

let app: INestApplication;
let owner: DatabaseHandle;
let teacher: string[];
let admin: string[];
let teacherId: string;

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

const ago = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);

function call(error: string | null, createdAt = ago(1)) {
  return {
    orgId, userId: teacherId, task: "generate", provider: "stub", modelId: "stub", inputTokens: 0, cacheWriteTokens: 0,
    cacheReadTokens: 0, outputTokens: 0, costUsd: "0", latencyMs: 5, error, createdAt,
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
  const [adminId] = ids.slice(1) as [string];
  teacherId = ids[0]!;
  await owner.db
    .insert(schema.organizations)
    .values({ id: orgId, name: "Problems center", slug: `problems-${orgId}`, createdAt: new Date() });
  await owner.db.insert(schema.members).values([
    { organizationId: orgId, userId: teacherId, role: "teacher", createdAt: new Date() },
    { organizationId: orgId, userId: adminId, role: "admin", createdAt: new Date() },
  ]);
  teacher = await signIn(emails[0]!);
  admin = await signIn(emails[1]!);

  const [doc] = await owner.db
    .insert(schema.documents)
    .values({ orgId, kind: "question_paper", title: "Force test", ownerId: teacherId, currentVersion: 1 })
    .returning({ id: schema.documents.id });
  const [chat] = await owner.db
    .insert(schema.chatSessions)
    .values({ orgId, userId: teacherId, title: "Motion doubts" })
    .returning({ id: schema.chatSessions.id });
  await owner.db.insert(schema.generationRuns).values({
    orgId, documentId: doc!.id, workflowId: `GeneratePaper:${doc!.id}`, spec: {}, status: "failed",
    error: "no evidence for 3 slots", finishedAt: ago(2),
  }); // prettier-ignore
  await owner.db.insert(schema.documentExports).values([
    { orgId, documentId: doc!.id, version: 1, format: "pdf", variant: "paper", status: "failed",
      error: "Chromium crashed", createdBy: teacherId, finishedAt: ago(3) },
    { orgId, documentId: doc!.id, version: 1, format: "docx", variant: "paper", status: "failed",
      error: "too old to list", createdBy: teacherId, finishedAt: ago(30) },
    { orgId, documentId: doc!.id, version: 1, format: "docx", variant: "answer_key", status: "done",
      createdBy: teacherId, finishedAt: ago(1) },
  ]); // prettier-ignore
  await owner.db.insert(schema.chatTurns).values({
    orgId, sessionId: chat!.id, clientTurnId: "t1", status: "failed", error: "engine unreachable", finishedAt: ago(4),
  }); // prettier-ignore
  await owner.db
    .insert(schema.llmCalls)
    .values([
      call("429 rate limited", ago(5)),
      call("429 rate limited", ago(1)),
      call("429 rate limited"),
      call(null),
    ]);
  await owner.db.insert(schema.sources).values({
    orgId, sha256: crypto.randomUUID(), filename: "scan.pdf", s3Key: "x", mimeType: "application/pdf",
    sizeBytes: 1, kind: "notes", licence: "own", status: "failed", error: "no text layer", uploadedBy: teacherId,
  }); // prettier-ignore
});

afterAll(async () => {
  await owner?.db.delete(schema.organizations).where(inArray(schema.organizations.id, [orgId]));
  await owner?.db.delete(schema.users).where(inArray(schema.users.email, emails));
  await app?.close();
  await owner?.pool.end();
});

describe("recent problems", () => {
  it("lists what failed in the last day, newest first, for admins only", async () => {
    await get(teacher, "system/problems").expect(403);
    const report = (await get(admin, "system/problems").expect(200)).body as ProblemReport;
    expect(report.items.map((p) => [p.kind, p.subject, p.person, p.error, p.count])).toEqual([
      ["source", "scan.pdf", "teacher", "no text layer", 1],
      ["ai_call", "generate · stub", null, "429 rate limited", 3],
      ["generation", "Force test", "teacher", "no evidence for 3 slots", 1],
      ["export", "Force test (pdf, paper)", "teacher", "Chromium crashed", 1],
      ["chat", "Motion doubts", "teacher", "engine unreachable", 1],
    ]);
    expect(Date.parse(report.since)).toBeLessThan(Date.now() - 23 * 60 * 60 * 1000);
  });

  it("sees every organization, for alerts across the deployment", async () => {
    const orgs = await app.get<ProblemStore>(PROBLEM_STORE).organizations();
    expect(orgs).toContainEqual({ id: orgId, name: "Problems center" });
  });
});
