import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";

import { loadEnv } from "../src/config/env.js";
import { valkeySecondaryStorage } from "../src/modules/identity/infrastructure/valkey-secondary-storage.js";

const redis = new Redis(loadEnv().VIDYAM_CACHE_REDIS_URL);
const prefix = `test:${crypto.randomUUID()}:`;
const storage = valkeySecondaryStorage(redis, prefix);

afterAll(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length) await redis.del(...keys);
  redis.disconnect();
});

describe("valkey secondary storage (rate limits, session cache)", () => {
  it("increments atomically; the TTL is set on creation and never extended", async () => {
    expect(await storage.increment("hits", 60)).toBe(1);
    expect(await storage.increment("hits", 600)).toBe(2);
    const ttl = await redis.ttl(`${prefix}hits`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it("stores with expiry, reads back, and getAndDelete removes", async () => {
    await storage.set("session", "value", 30);
    expect(await redis.ttl(`${prefix}session`)).toBeLessThanOrEqual(30);
    expect(await storage.get("session")).toBe("value");
    expect(await storage.getAndDelete("session")).toBe("value");
    expect(await storage.get("session")).toBeNull();
  });
});
