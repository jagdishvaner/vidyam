import "server-only";

import type { CurrentUser } from "@vidyam/contracts";
import { cacheLife } from "next/cache";
import { redirect } from "next/navigation";

import { serverApi } from "./api";

/**
 * Data Access Layer: the signed-in user, their organization and role, as the API sees them.
 * Cached privately (per browser, never on the server) for a short time so navigation stays instant.
 * Must be called inside a <Suspense> boundary (it reads the request's cookies).
 */
export async function getCurrentUser(): Promise<CurrentUser> {
  "use cache: private";
  cacheLife({ stale: 30, revalidate: 60, expire: 300 });

  const api = await serverApi();
  const { data, response } = await api.GET("/api/me");
  if (response.status === 401 || !data) redirect("/login");
  return data;
}
