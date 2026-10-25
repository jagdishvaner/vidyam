import { schema, type Database } from "@vidyam/db";
import { betterAuth, type SecondaryStorage } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, organization } from "better-auth/plugins";
import { asc, eq } from "drizzle-orm";

import type { Env } from "../../../config/env.js";
import { PLATFORM_ADMIN } from "../domain/roles.js";
import { accessControl, orgRoles, platformAccessControl, platformRoles } from "./access-control.js";

/**
 * Runtime Better Auth config. Plugins and model names must match packages/db/scripts/better-auth.schema.ts,
 * which generates the tables; the integration tests exercise both against the migrated database.
 */
export function createAuth({ env, db, cache }: { env: Env; db: Database; cache: SecondaryStorage }) {
  return betterAuth({
    appName: "Vidyam",
    // The browser reaches the API through the app origin (Caddy locally, CloudFront on AWS).
    baseURL: env.VIDYAM_APP_URL,
    basePath: "/api/auth",
    secret: env.VIDYAM_AUTH_SECRET,
    trustedOrigins: [env.VIDYAM_APP_URL],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
        organizations: schema.organizations,
        members: schema.members,
        invitations: schema.invitations,
      },
    }),
    advanced: { database: { generateId: "uuid" } },
    secondaryStorage: cache,
    user: { modelName: "users" },
    // Postgres stays the source of truth for sessions: the cache is LRU-evicting.
    session: { modelName: "sessions", storeSessionInDatabase: true },
    rateLimit: {
      enabled: true, // also locally, so development behaves like production
      storage: "secondary-storage",
      window: 60,
      max: 300,
      customRules: {
        // Limits are per client IP, and a center's staff usually share one internet connection:
        // generous enough for everyone signing in at 9 am, still far too low for password guessing.
        "/sign-in/email": { window: 60, max: 30 },
      },
    },
    account: { modelName: "accounts" },
    verification: { modelName: "verifications" },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      // Center admins create every login and set passwords (ADR 0011); there is no email.
      disableSignUp: true,
    },
    databaseHooks: {
      session: {
        create: {
          // Sign-in lands in the user's first organization, so every request has a tenant from the start.
          async before(session) {
            const [membership] = await db
              .select({ organizationId: schema.members.organizationId })
              .from(schema.members)
              .where(eq(schema.members.userId, session.userId))
              .orderBy(asc(schema.members.createdAt))
              .limit(1);
            return { data: { ...session, activeOrganizationId: membership?.organizationId ?? null } };
          },
        },
      },
    },
    plugins: [
      admin({
        ac: platformAccessControl,
        roles: platformRoles,
        adminRoles: [PLATFORM_ADMIN],
        defaultRole: "user",
      }),
      organization({
        ac: accessControl,
        roles: orgRoles,
        creatorRole: "admin",
        allowUserToCreateOrganization: async (user) => (user as { role?: string }).role === PLATFORM_ADMIN,
        // Staff, not students, are members; the default cap of 100 is too low for a large center.
        membershipLimit: 1000,
        schema: {
          organization: { modelName: "organizations" },
          member: { modelName: "members" },
          invitation: { modelName: "invitations" },
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
