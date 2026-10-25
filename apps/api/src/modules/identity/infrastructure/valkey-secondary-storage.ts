import type { SecondaryStorage } from "better-auth";
import type { Redis } from "ioredis";

/**
 * Better Auth secondary storage on valkey-cache: shared by every API instance, so rate limits hold across
 * instances and session lookups skip the database. Sessions are also kept in Postgres (the cache may evict).
 */
export function valkeySecondaryStorage(redis: Redis, prefix = "auth:"): SecondaryStorage {
  const k = (key: string) => `${prefix}${key}`;
  return {
    get: (key) => redis.get(k(key)),
    getAndDelete: (key) => redis.getdel(k(key)),
    async increment(key, ttl) {
      // TTL only on creation (EXPIRE NX), so the window is fixed from the first hit; atomic via MULTI.
      const results = await redis.multi().incr(k(key)).expire(k(key), ttl, "NX").exec();
      return Number(results?.[0]?.[1]);
    },
    set: (key, value, ttl) => (ttl ? redis.set(k(key), value, "EX", ttl) : redis.set(k(key), value)),
    delete: (key) => redis.del(k(key)).then(() => undefined),
  };
}

/** In-process storage for one-off scripts (e.g. seeding) that have no shared cache. */
export function memorySecondaryStorage(): SecondaryStorage {
  const values = new Map<string, string>();
  return {
    get: (key) => values.get(key) ?? null,
    getAndDelete(key) {
      const value = values.get(key) ?? null;
      values.delete(key);
      return value;
    },
    increment(key) {
      const next = Number(values.get(key) ?? 0) + 1;
      values.set(key, String(next));
      return next;
    },
    set: (key, value) => void values.set(key, value),
    delete: (key) => void values.delete(key),
  };
}
