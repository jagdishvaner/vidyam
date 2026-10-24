import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));
const APP_ROLE = "vidyam_app";

/** Applies pending migrations. Must run as the schema owner (never as the runtime role). */
export async function runMigrations(adminUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: adminUrl, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS });
  } finally {
    await pool.end();
  }
}

/**
 * Local development only: lets the runtime role log in with the password from VIDYAM_DATABASE_URL.
 * On AWS the password comes from Secrets Manager and this is never called.
 */
export async function syncLocalAppRolePassword(adminUrl: string, appUrl: string): Promise<void> {
  const app = new URL(appUrl);
  if (decodeURIComponent(app.username) !== APP_ROLE) {
    throw new Error(`VIDYAM_DATABASE_URL must connect as ${APP_ROLE}, got ${app.username}`);
  }
  if (!["localhost", "127.0.0.1"].includes(app.hostname)) {
    throw new Error("refusing to set the app role password on a non-local database");
  }
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const password = client.escapeLiteral(decodeURIComponent(app.password));
    await client.query(`ALTER ROLE ${APP_ROLE} WITH LOGIN PASSWORD ${password}`);
  } finally {
    await client.end();
  }
}
