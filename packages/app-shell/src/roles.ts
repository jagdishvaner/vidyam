import type { CurrentUser } from "@vidyam/contracts";

/** Message key under `roles.*` for the user's most relevant role. Shared by server and client components. */
export function roleKey(user: Pick<CurrentUser, "platformRole" | "orgRole">) {
  return user.platformRole ?? user.orgRole ?? "none";
}
