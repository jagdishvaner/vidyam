import "server-only";

/** Server-side only: where Server Components reach the API directly (not through the public origin). */
export const API_INTERNAL_URL = process.env.VIDYAM_API_INTERNAL_URL ?? "http://localhost:38110";
