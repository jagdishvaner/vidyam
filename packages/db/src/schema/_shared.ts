import { sql } from "drizzle-orm";
import { pgPolicy, pgRole, timestamp, uuid } from "drizzle-orm/pg-core";

import { organizations } from "./auth.js";

/**
 * Runtime role used by the API and the AI engine. Row-level security applies to it because it does not own
 * the tables; migrations and seeds run as the owner. Created by migration 0000 (see migrations/).
 */
export const appRole = pgRole("vidyam_app").existing();

/** The organization of the current transaction, set with `SET LOCAL app.org_id` (see withOrgContext). */
export const currentOrgId = sql`nullif(current_setting('app.org_id', true), '')::uuid`;

export const id = () => uuid().primaryKey().defaultRandom();

export const createdAt = () => timestamp({ withTimezone: true }).defaultNow().notNull();

export const timestamps = {
  createdAt: createdAt(),
  updatedAt: timestamp({ withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};

export const orgId = () =>
  uuid()
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

/** Rows are visible to, and writable by, the runtime role only inside their own organization. */
export const orgIsolation = (table: string) =>
  pgPolicy(`${table}_org_isolation`, {
    as: "permissive",
    for: "all",
    to: appRole,
    using: sql`org_id = ${currentOrgId}`,
    withCheck: sql`org_id = ${currentOrgId}`,
  });
