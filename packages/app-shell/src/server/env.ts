import "server-only";

/** Server-side only: where Server Components reach the API directly (not through the public origin). */
export const API_INTERNAL_URL = process.env.VIDYAM_API_INTERNAL_URL ?? "http://localhost:38110";

/** Where the two apps live, for links between them (the teachers' app and the admin panel's subdomain). */
export const APP_URL = process.env.VIDYAM_APP_URL ?? "http://localhost:38000";
export const ADMIN_URL = process.env.VIDYAM_ADMIN_URL ?? "http://localhost:38001";
