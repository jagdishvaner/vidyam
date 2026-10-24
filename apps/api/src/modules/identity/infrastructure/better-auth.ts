import { schema, type Database } from "@vidyam/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, organization } from "better-auth/plugins";
import { asc, eq } from "drizzle-orm";

import type { Env } from "../../../config/env.js";
import { PLATFORM_ADMIN } from "../domain/roles.js";
import { accessControl, orgRoles, platformAccessControl, platformRoles } from "./access-control.js";
import type { Mailer } from "./mailer.js";

/**
 * Runtime Better Auth config. Plugins and model names must match packages/db/scripts/better-auth.schema.ts,
 * which generates the tables; the integration tests exercise both against the migrated database.
 */
export function createAuth({ env, db, mailer }: { env: Env; db: Database; mailer: Mailer }) {
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
    user: { modelName: "users" },
    session: { modelName: "sessions" },
    account: { modelName: "accounts" },
    verification: { modelName: "verifications" },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      async sendResetPassword({ user, url }) {
        await mailer.send({
          to: user.email,
          subject: "Reset your Vidyam password",
          text: `Open this link to choose a new password:\n\n${url}\n\nIf you didn't ask for this, ignore this email.`,
        });
      },
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
        async sendInvitationEmail({ email, organization: org, inviter, id, role }) {
          await mailer.send({
            to: email,
            subject: `You're invited to ${org.name} on Vidyam`,
            text:
              `${inviter.user.name} invited you to join ${org.name} as ${role}.\n\n` +
              `Accept the invitation: ${env.VIDYAM_APP_URL}/invite/${id}\n`,
          });
        },
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
