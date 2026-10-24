/** `pnpm db:migrate`: migrate the development and test databases, then let the runtime role log in locally. */
import path from "node:path";

import { runMigrations, syncLocalAppRolePassword } from "../src/migrate.js";

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env"));
} catch {
  // No .env: rely on the real environment (CI, AWS).
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  return value;
}

const targets = [
  { name: "development", admin: required("VIDYAM_DATABASE_ADMIN_URL"), app: required("VIDYAM_DATABASE_URL") },
  {
    name: "test",
    admin: process.env.VIDYAM_TEST_DATABASE_ADMIN_URL,
    app: process.env.VIDYAM_TEST_DATABASE_URL,
  },
];

for (const target of targets) {
  if (!target.admin) continue;
  await runMigrations(target.admin);
  if (target.app) await syncLocalAppRolePassword(target.admin, target.app);
  console.log(`migrated ${target.name} database`);
}
