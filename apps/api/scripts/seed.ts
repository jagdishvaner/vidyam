/**
 * `pnpm db:seed` (local/staging): model registry + routes, the first super-admin, one organization with that
 * admin as its center admin, and the starting exam catalog. Safe to run repeatedly.
 */
import { createDatabase, schema, seedExamCatalog, seedLlmRegistry } from "@vidyam/db";
import { and, eq } from "drizzle-orm";

import { loadEnv } from "../src/config/env.js";
import { PLATFORM_ADMIN } from "../src/modules/identity/domain/roles.js";
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
const orgSlug = orgName
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

// Seeds run as the schema owner (row-level security does not apply) and send no email.
const { db, pool } = createDatabase(required("VIDYAM_DATABASE_ADMIN_URL"), { max: 2 });
const auth = createAuth({ env, db, mailer: { send: async () => {} }, cache: memorySecondaryStorage() });

try {
  await seedLlmRegistry(db);

  const findUser = () => db.select().from(schema.users).where(eq(schema.users.email, admin.email)).limit(1);
  if ((await findUser()).length === 0) {
    await auth.api.signUpEmail({ body: admin });
  }
  const [user] = await findUser();
  await db
    .update(schema.users)
    .set({ role: PLATFORM_ADMIN, emailVerified: true })
    .where(eq(schema.users.id, user!.id));

  let [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.slug, orgSlug));
  if (!org) {
    [org] = await db
      .insert(schema.organizations)
      .values({ name: orgName, slug: orgSlug, createdAt: new Date() })
      .returning();
  }
  const [membership] = await db
    .select()
    .from(schema.members)
    .where(and(eq(schema.members.organizationId, org!.id), eq(schema.members.userId, user!.id)));
  if (!membership) {
    await db
      .insert(schema.members)
      .values({ organizationId: org!.id, userId: user!.id, role: "admin", createdAt: new Date() });
  }

  await seedExamCatalog(db, org!.id);
  console.log(
    `seeded: super-admin ${admin.email}, organization "${org!.name}", models, routes, exam catalog`,
  );
} finally {
  await pool.end();
}
