import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, runMigrations, schema, withOrgContext, type DatabaseHandle } from "../src/index.js";

const adminUrl = process.env.VIDYAM_TEST_DATABASE_ADMIN_URL!;
const appUrl = process.env.VIDYAM_TEST_DATABASE_URL!;

let admin: DatabaseHandle;
let app: DatabaseHandle;
const orgA = crypto.randomUUID();
const orgB = crypto.randomUUID();

function source(orgId: string, name: string) {
  return {
    orgId,
    sha256: crypto.randomUUID(),
    filename: name,
    s3Key: `raw/${name}`,
    mimeType: "application/pdf",
    sizeBytes: 1,
    kind: "book" as const,
    licence: "own" as const,
  };
}

beforeAll(async () => {
  await runMigrations(adminUrl);
  admin = createDatabase(adminUrl, { max: 2 });
  app = createDatabase(appUrl, { max: 2 });
  // The owner bypasses RLS, like seeds and migrations do.
  await admin.db.insert(schema.organizations).values([
    { id: orgA, name: "Center A", slug: `a-${orgA}`, createdAt: new Date() },
    { id: orgB, name: "Center B", slug: `b-${orgB}`, createdAt: new Date() },
  ]);
  await admin.db.insert(schema.sources).values([source(orgA, "a.pdf"), source(orgB, "b.pdf")]);
});

afterAll(async () => {
  await admin.db.delete(schema.organizations).where(sql`id in (${orgA}, ${orgB})`);
  await Promise.all([admin.pool.end(), app.pool.end()]);
});

describe("row-level security for the runtime role", () => {
  it("connects as the restricted role, not the owner", async () => {
    const { rows } = await app.pool.query(
      "select current_user, rolbypassrls from pg_roles where rolname = current_user",
    );
    expect(rows[0]).toEqual({ current_user: "vidyam_app", rolbypassrls: false });
  });

  it("sees nothing without an organization context", async () => {
    expect(await app.db.select().from(schema.sources)).toEqual([]);
  });

  it("sees only its own organization's rows", async () => {
    const rows = await withOrgContext(app.db, orgA, (tx) => tx.select().from(schema.sources));
    expect(rows.map((r) => r.filename)).toEqual(["a.pdf"]);
  });

  it("cannot write rows for another organization", async () => {
    const error = await withOrgContext(app.db, orgA, (tx) =>
      tx.insert(schema.sources).values(source(orgB, "sneaky.pdf")),
    ).catch((e: unknown) => e);
    // Drizzle wraps the driver error; the cause is Postgres' own RLS rejection.
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    expect(cause?.code).toBe("42501");
    expect(cause?.message).toMatch(/row-level security/);
  });

  it("rejects a malformed organization id before touching the database", async () => {
    await expect(withOrgContext(app.db, "1 or 1=1", async () => 1)).rejects.toThrow(
      /invalid organization id/,
    );
  });
});
