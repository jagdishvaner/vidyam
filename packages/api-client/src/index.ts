import createClient from "openapi-fetch";

import type { paths } from "./generated/schema.js";

export type { components, paths } from "./generated/schema.js";

/**
 * Typed fetch client for the Vidyam API. Request and response types come from the OpenAPI document,
 * which is generated from the same zod contracts the API validates with.
 */
export function createApiClient(options: { baseUrl: string; headers?: HeadersInit; fetch?: typeof fetch }) {
  return createClient<paths>(options);
}

export type ApiClient = ReturnType<typeof createApiClient>;
