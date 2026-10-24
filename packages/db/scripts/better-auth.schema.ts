/**
 * Schema-only Better Auth config, used by `pnpm auth:generate` to (re)generate src/schema/auth.ts.
 * It must enable the same plugins and model names as the API's runtime config
 * (apps/api/src/modules/identity/infrastructure/better-auth.ts); the API's integration tests exercise
 * sign-up, organizations and invitations against the migrated database, so a mismatch fails CI.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, organization } from "better-auth/plugins";

export const auth = betterAuth({
  database: drizzleAdapter({}, { provider: "pg" }),
  advanced: { database: { generateId: "uuid" } },
  user: { modelName: "users" },
  session: { modelName: "sessions" },
  account: { modelName: "accounts" },
  verification: { modelName: "verifications" },
  plugins: [
    admin(),
    organization({
      schema: {
        organization: { modelName: "organizations" },
        member: { modelName: "members" },
        invitation: { modelName: "invitations" },
      },
    }),
  ],
});
