import { createApiClient } from "@vidyam/api-client";

/** Browser API client. Same origin as the page (/api/* is routed to NestJS), so session cookies just work. */
export const api = createApiClient({ baseUrl: "" });
