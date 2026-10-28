import "server-only";

import { createApiClient } from "@vidyam/api-client";
import { cookies } from "next/headers";

import { API_INTERNAL_URL } from "./env";

/** Typed API client for Server Components; forwards the user's cookies so the API sees their session. */
export async function serverApi() {
  const cookieHeader = (await cookies()).toString();
  return createApiClient({ baseUrl: API_INTERNAL_URL, headers: { cookie: cookieHeader } });
}
