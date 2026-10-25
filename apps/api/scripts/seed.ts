/**
 * `pnpm db:seed` (local/staging): model registry + routes, the first super-admin, one organization with that
 * admin as its center admin, the starting exam catalog and, when VIDYAM_SEED_DEMO_PASSWORD is set, one demo
 * login per remaining role. Safe to run repeatedly; existing accounts keep their passwords.
 */
import { createDatabase, schema, seedExamCatalog, seedLlmRegistry } from "@vidyam/db";
import { and, eq } from "drizzle-orm";

import { loadEnv } from "../src/config/env.js";
import { PLATFORM_ADMIN, type OrgRoleName } from "../src/modules/identity/domain/roles.js";
import { createAuth } from "../src/modules/identity/infrastructure/better-auth.js";
import { memorySecondaryStorage } from "../src/modules/identity/infrastructure/valkey-secondary-storage.js";

const env = loadEnv();
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  return value;
};
const admin = {
  email: required("VIDYAM_SEED_ADMIN_EMAIL").toLowerCase(),
  password: required("VIDYAM_SEED_ADMIN_PASSWORD"),
  name: required("VIDYAM_SEED_ADMIN_NAME"),
};
const orgName = required("VIDYAM_SEED_ORG_NAME");
const demoPassword = process.env.VIDYAM_SEED_DEMO_PASSWORD;
const demoMembers: { email: string; name: string; role: OrgRoleName }[] = [
  { email: "teacher@vidyam.local", name: "Demo Teacher", role: "teacher" },
  { email: "reviewer@vidyam.local", name: "Demo Reviewer", role: "reviewer" },
  { email: "operator@vidyam.local", name: "Demo Content Operator", role: "content_operator" },
];
const orgSlug = orgName
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

// Seeds run as the schema owner (row-level security does not apply).
const { db, pool } = createDatabase(required("VIDYAM_DATABASE_ADMIN_URL"), { max: 2 });
const auth = createAuth({ env, db, cache: memorySecondaryStorage() });

/** Creates the login if it doesn't exist yet (public sign-up is off, so through the admin API). */
async function ensureUser(user: { email: string; password: string; name: string }) {
  const find = () => db.select().from(schema.users).where(eq(schema.users.email, user.email)).limit(1);
  if ((await find()).length === 0) await auth.api.createUser({ body: user });
  const [row] = await find();
  return row!;
}

async function ensureMember(organizationId: string, userId: string, role: OrgRoleName) {
  const [membership] = await db
    .select()
    .from(schema.members)
    .where(and(eq(schema.members.organizationId, organizationId), eq(schema.members.userId, userId)));
  if (!membership) {
    await db.insert(schema.members).values({ organizationId, userId, role, createdAt: new Date() });
  }
}

try {
  await seedLlmRegistry(db);

  const user = await ensureUser(admin);
  await db
    .update(schema.users)
    .set({ role: PLATFORM_ADMIN, emailVerified: true })
    .where(eq(schema.users.id, user.id));

  let [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.slug, orgSlug));
  if (!org) {
    [org] = await db
      .insert(schema.organizations)
      .values({ name: orgName, slug: orgSlug, createdAt: new Date() })
      .returning();
  }
  await ensureMember(org!.id, user.id, "admin");

  if (demoPassword) {
    for (const demo of demoMembers) {
      const demoUser = await ensureUser({ email: demo.email, name: demo.name, password: demoPassword });
      await ensureMember(org!.id, demoUser.id, demo.role);
    }
  }

  await seedExamCatalog(db, org!.id);
  console.log(
    `seeded: super-admin ${admin.email}, organization "${org!.name}", ` +
      `${demoPassword ? "demo logins, " : ""}models, routes, exam catalog`,
  );
} finally {
  await pool.end();
}
