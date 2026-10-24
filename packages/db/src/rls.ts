import { sql } from "drizzle-orm";

import type { Database, Transaction } from "./client.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` in a transaction scoped to one organization. Row-level security policies only expose rows whose
 * org_id matches, so a query that forgets a tenant filter still cannot read another center's data.
 */
export async function withOrgContext<T>(
  db: Database,
  orgId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  if (!UUID.test(orgId)) throw new Error(`withOrgContext: invalid organization id ${JSON.stringify(orgId)}`);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return fn(tx);
  });
}
