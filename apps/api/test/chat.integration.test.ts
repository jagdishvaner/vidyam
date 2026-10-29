/**
 * The chat backend (plan v3 step 22, ADR 0015) against the test database and Valkey, with a stand-in AI engine
 * whose answers each test sets: chats and their history, turns recorded once however often they are sent,
 * answers relayed as Server-Sent Events that resume after a dropped connection, and the answer stored when it
 * ends, also when it fails.
 */
import "reflect-metadata";

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AuthService } from "@thallesp/nestjs-better-auth";
import type { ChatEngineEvent, ChatEngineTurn } from "@vidyam/contracts";
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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { loadEnv } from "../src/config/env.js";
import { SendTurn } from "../src/modules/chat/application/send-turn.js";
import type { Auth } from "../src/modules/identity/infrastructure/better-auth.js";

const base = loadEnv();
const testDbUrl = process.env.VIDYAM_TEST_DATABASE_URL!;
const testAdminUrl = process.env.VIDYAM_TEST_DATABASE_ADMIN_URL!;
const ORIGIN = base.VIDYAM_APP_URL;
const password = "a-long-test-password-1";
const orgId = crypto.randomUUID();
const emails = [`chat-a-${orgId}@vidyam.test`, `chat-b-${orgId}@vidyam.test`];

/** The stand-in AI engine: what it was asked, and the lines it answers with. */
const engine = {
  asked: [] as ChatEngineTurn[],
  tokens: [] as string[],
  script: [] as (ChatEngineEvent | { wait: number } | { hangUp: true })[],
};
let engineServer: Server;
let app: INestApplication;
let owner: DatabaseHandle;
let teacherA: string[];
let teacherB: string[];
let teacherAId: string;

function answer(text: string, title: string | null = "Doubt: Ohm's law"): typeof engine.script {
  const half = Math.ceil(text.length / 2);
  return [
    { event: "text_delta", text: text.slice(0, half) },
    { wait: 80 },
    { event: "text_delta", text: text.slice(half) },
    { event: "done", blocks: [{ type: "text", text }], modelId: null, title, sessionStatus: "idle" },
  ];
}

async function startEngine(): Promise<string> {
  engineServer = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", async () => {
      engine.asked.push(JSON.parse(body) as ChatEngineTurn);
      engine.tokens.push(String(req.headers["x-vidyam-service-token"]));
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      for (const step of engine.script) {
        if ("wait" in step) await new Promise((resolve) => setTimeout(resolve, step.wait));
        else if ("hangUp" in step) return void res.destroy();
        else res.write(`${JSON.stringify(step)}\n`);
      }
      res.end();
    });
  });
  await new Promise<void>((resolve) => engineServer.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(engineServer.address() as AddressInfo).port}`;
}

async function signIn(email: string): Promise<string[]> {
  const res = await request(app.getHttpServer())
    .post("/api/auth/sign-in/email")
    .set("Origin", ORIGIN)
    .send({ email, password })
    .expect(200);
  return res.get("Set-Cookie") ?? [];
}

interface SseEvent {
  id: string;
  event: string;
  [key: string]: unknown;
}

/** Reads a turn's Server-Sent Events to the end, optionally after a Last-Event-ID. */
async function follow(cookies: string[], turnId: string, lastEventId?: string): Promise<SseEvent[]> {
  const call = request(app.getHttpServer())
    .get(`/api/chat/turns/${turnId}/events`)
    .set("Cookie", cookies)
    .buffer(true)
    .parse((res, done) => {
      let text = "";
      res.on("data", (chunk: Buffer) => (text += chunk.toString()));
      res.on("end", () => done(null, text));
    });
  if (lastEventId) void call.set("Last-Event-ID", lastEventId);
  const res = await call.expect(200).expect("content-type", /text\/event-stream/);
  return (res.body as string)
    .split("\n\n")
    .filter((block) => block.includes("data: "))
    .map((block) => ({
      id: /^id: (.*)$/m.exec(block)![1]!,
      ...(JSON.parse(/^data: (.*)$/m.exec(block)![1]!) as { event: string }),
    }));
}

async function newChat(cookies: string[]): Promise<string> {
  const res = await request(app.getHttpServer())
    .post("/api/chat/sessions")
    .set("Cookie", cookies)
    .send({})
    .expect(201);
  return res.body.id as string;
}

function send(cookies: string[], chatId: string, text: string, clientTurnId: string = crypto.randomUUID()) {
  return request(app.getHttpServer())
    .post(`/api/chat/sessions/${chatId}/turns`)
    .set("Cookie", cookies)
    .send({ clientTurnId, input: { kind: "text", text } });
}

beforeAll(async () => {
  const redis = new Redis(base.VIDYAM_CACHE_REDIS_URL);
  const limits = await redis.keys("auth:*|/sign-in/email");
  if (limits.length) await redis.del(...limits);
  redis.disconnect();
  await runMigrations(testAdminUrl);
  await syncLocalAppRolePassword(testAdminUrl, testDbUrl);
  owner = createDatabase(testAdminUrl, { max: 2 });

  const env = { ...base, VIDYAM_DATABASE_URL: testDbUrl, VIDYAM_AI_INTERNAL_URL: await startEngine() };
  app = await NestFactory.create(AppModule.forRoot(env), { bodyParser: false, logger: false });
  app.setGlobalPrefix("api");
  await app.init();

  const auth = app.get<AuthService<Auth>>(AuthService);
  const ids = [];
  for (const email of emails) {
    ids.push((await auth.api.createUser({ body: { email, password, name: "Chat Teacher" } })).user.id);
  }
  teacherAId = ids[0]!;
  await owner.db
    .insert(schema.organizations)
    .values({ id: orgId, name: "Chat center", slug: `chat-${orgId}`, createdAt: new Date() });
  await owner.db
    .insert(schema.members)
    .values(ids.map((userId) => ({ organizationId: orgId, userId, role: "teacher", createdAt: new Date() })));
  teacherA = await signIn(emails[0]!);
  teacherB = await signIn(emails[1]!);
});

afterAll(async () => {
  await app?.get(SendTurn).settled();
  await owner?.db.delete(schema.organizations).where(inArray(schema.organizations.id, [orgId]));
  await owner?.db.delete(schema.users).where(inArray(schema.users.email, emails));
  await app?.close();
  await owner?.pool.end();
  engineServer?.close();
});

beforeEach(() => {
  engine.asked = [];
  engine.tokens = [];
  engine.script = answer("Ohm's law: V = IR, at constant temperature.");
});

describe("chat", () => {
  it("answers a turn as a stream, then keeps it in the chat with a title", async () => {
    const chatId = await newChat(teacherA);
    const sent = await send(teacherA, chatId, "ओम का नियम क्या है?").expect(202);
    const { turnId, userMessageId, assistantMessageId } = sent.body as Record<string, string>;
    const events = await follow(teacherA, turnId!);

    expect(events.map((e) => e.event)).toEqual([
      "turn_started",
      "text_delta",
      "text_delta",
      "message_complete",
    ]);
    expect(events[0]).toMatchObject({ turnId, messageId: assistantMessageId });
    expect(
      events
        .filter((e) => e.event === "text_delta")
        .map((e) => e.text)
        .join(""),
    ).toBe("Ohm's law: V = IR, at constant temperature.");
    expect(engine.asked).toEqual([
      { orgId, userId: teacherAId, sessionId: chatId, turnId, userMessageId, modelId: null },
    ]);
    expect(engine.tokens).toEqual([base.VIDYAM_AI_INTERNAL_TOKEN]);

    const detail = await request(app.getHttpServer())
      .get(`/api/chat/sessions/${chatId}`)
      .set("Cookie", teacherA)
      .expect(200);
    expect(detail.body.session).toMatchObject({ title: "Doubt: Ohm's law", status: "idle" });
    expect(detail.body.activeTurnId).toBeNull();
    expect(detail.body.messages).toMatchObject([
      { id: userMessageId, seq: 1, role: "user", blocks: [{ type: "text", text: "ओम का नियम क्या है?" }] },
      {
        id: assistantMessageId,
        seq: 2,
        role: "assistant",
        blocks: [{ type: "text", text: "Ohm's law: V = IR, at constant temperature." }],
      },
    ]);

    // A dropped connection resumes after the last event it saw.
    const resumed = await follow(teacherA, turnId!, events[1]!.id);
    expect(resumed.map((e) => e.event)).toEqual(["text_delta", "message_complete"]);
  });

  it("records a retried turn once, and one turn at a time per chat", async () => {
    const chatId = await newChat(teacherA);
    engine.script = [{ wait: 400 }, ...answer("Slow answer.", null)];
    const first = await send(teacherA, chatId, "first", "same-browser-turn").expect(202);
    const retried = await send(teacherA, chatId, "first", "same-browser-turn").expect(202);
    expect(retried.body.turnId).toBe(first.body.turnId);
    await send(teacherA, chatId, "second").expect(409);
    await follow(teacherA, first.body.turnId as string);
    await app.get(SendTurn).settled();
    expect(engine.asked).toHaveLength(1);
    await send(teacherA, chatId, "second").expect(202);
    await app.get(SendTurn).settled();
  });

  it("keeps the failed answer and says why", async () => {
    const chatId = await newChat(teacherA);
    engine.script = [
      { event: "text_delta", text: "Partly" },
      { event: "error", code: "budget_exceeded", message: "Your monthly AI budget of US$5.00 is used up" },
    ];
    const failed = await send(teacherA, chatId, "explain refraction").expect(202);
    const events = await follow(teacherA, failed.body.turnId as string);
    expect(events.map((e) => e.event)).toEqual(["turn_started", "text_delta", "error", "message_complete"]);

    engine.script = [{ event: "text_delta", text: "and then" }, { hangUp: true }];
    const cut = await send(teacherA, chatId, "and again").expect(202);
    expect(
      (await follow(teacherA, cut.body.turnId as string)).find((e) => e.event === "error"),
    ).toMatchObject({
      code: expect.stringMatching(/engine_unavailable|interrupted/),
    });

    const detail = await request(app.getHttpServer())
      .get(`/api/chat/sessions/${chatId}`)
      .set("Cookie", teacherA);
    expect(detail.body.messages[1].blocks).toEqual([
      { type: "text", text: "Partly" },
      { type: "error", code: "budget_exceeded", message: "Your monthly AI budget of US$5.00 is used up" },
    ]);
  });

  it("lists, searches, pins, renames and archives a teacher's own chats", async () => {
    const server = app.getHttpServer();
    const chatId = await newChat(teacherA);
    await send(teacherA, chatId, "प्रकाश का अपवर्तन समझाइए").expect(202);
    await app.get(SendTurn).settled();
    const other = await newChat(teacherA);

    const found = await request(server)
      .get("/api/chat/sessions?q=अपवर्तन")
      .set("Cookie", teacherA)
      .expect(200);
    expect(found.body.items.map((c: { id: string }) => c.id)).toEqual([chatId]);

    await request(server)
      .patch(`/api/chat/sessions/${chatId}`)
      .set("Cookie", teacherA)
      .send({ pinned: true, title: "Refraction" })
      .expect(200);
    const list = await request(server).get("/api/chat/sessions").set("Cookie", teacherA).expect(200);
    expect(list.body.items[0]).toMatchObject({ id: chatId, pinned: true, title: "Refraction" });
    expect(list.body.items.map((c: { id: string }) => c.id)).toContain(other);

    await request(server)
      .patch(`/api/chat/sessions/${other}`)
      .set("Cookie", teacherA)
      .send({ archived: true })
      .expect(200);
    const active = await request(server).get("/api/chat/sessions").set("Cookie", teacherA);
    expect(active.body.items.map((c: { id: string }) => c.id)).not.toContain(other);
    const archived = await request(server).get("/api/chat/sessions?show=archived").set("Cookie", teacherA);
    expect(archived.body.items.map((c: { id: string }) => c.id)).toEqual([other]);

    await request(server)
      .patch(`/api/chat/sessions/${chatId}`)
      .set("Cookie", teacherA)
      .send({ modelId: "no-such-model" })
      .expect(422);
    await request(server).patch(`/api/chat/sessions/${chatId}`).set("Cookie", teacherA).send({}).expect(400);
  });

  it("keeps chats private to their teacher", async () => {
    const server = app.getHttpServer();
    const chatId = await newChat(teacherA);
    const sent = await send(teacherA, chatId, "hello").expect(202);
    await app.get(SendTurn).settled();
    await request(server).get(`/api/chat/sessions/${chatId}`).set("Cookie", teacherB).expect(404);
    await request(server)
      .patch(`/api/chat/sessions/${chatId}`)
      .set("Cookie", teacherB)
      .send({ pinned: true })
      .expect(404);
    await send(teacherB, chatId, "mine now?").expect(404);
    await request(server)
      .get(`/api/chat/turns/${sent.body.turnId}/events`)
      .set("Cookie", teacherB)
      .expect(404);
    const list = await request(server).get("/api/chat/sessions").set("Cookie", teacherB).expect(200);
    expect(list.body.items).toEqual([]);
  });

  it("refuses a turn once the teacher's monthly budget is used up", async () => {
    const chatId = await newChat(teacherA);
    await owner.db.insert(schema.quotas).values({ orgId, userId: teacherAId, monthlyLimitUsd: "0.00" });
    const refused = await send(teacherA, chatId, "one more question").expect(403);
    expect(refused.body.message).toBe("Your monthly AI budget of US$0.00 is used up.");
    expect(engine.asked).toEqual([]);
    await owner.db.delete(schema.quotas).where(inArray(schema.quotas.orgId, [orgId]));
  });
});
