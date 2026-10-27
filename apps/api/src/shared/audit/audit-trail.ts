import { Injectable } from "@nestjs/common";
import { schema } from "@vidyam/db";

import { OrgDatabase } from "../database/org-database.js";

/** Writes audit_log rows inside the center's row-level-security context. */
@Injectable()
export class AuditTrail {
  constructor(private readonly orgDb: OrgDatabase) {}

  async record(entry: {
    orgId: string;
    userId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    data: Record<string, unknown>;
  }): Promise<void> {
    await this.orgDb.run(entry.orgId, (tx) => tx.insert(schema.auditLog).values(entry));
  }
}
