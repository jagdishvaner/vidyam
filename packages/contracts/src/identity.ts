import { z } from "zod";

import { OrgRole, Uuid } from "./common.js";
import { contract } from "./registry.js";

/** The signed-in user, their active organization and their role in it (GET /api/me). */
export const CurrentUser = contract(
  "CurrentUser",
  z.object({
    id: Uuid,
    name: z.string(),
    email: z.email(),
    /** Platform role from the admin plugin: "superadmin" or null for everyone else. */
    platformRole: z.enum(["superadmin"]).nullable(),
    organization: z.object({ id: Uuid, name: z.string(), slug: z.string() }).nullable(),
    orgRole: OrgRole.nullable(),
  }),
);
export type CurrentUser = z.infer<typeof CurrentUser>;
