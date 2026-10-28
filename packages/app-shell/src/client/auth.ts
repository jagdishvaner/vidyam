import { adminClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Better Auth client; requests go to /api/auth on the same origin. */
export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [organizationClient(), adminClient()],
});
