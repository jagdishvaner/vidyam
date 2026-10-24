import { Inject, Injectable } from "@nestjs/common";
import { withOrgContext, type DatabaseHandle, type Transaction } from "@vidyam/db";

import { DATABASE } from "./tokens.js";

/** Runs queries inside one organization's row-level-security context. Use for every tenant table. */
@Injectable()
export class OrgDatabase {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  run<T>(orgId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withOrgContext(this.database.db, orgId, fn);
  }
}
