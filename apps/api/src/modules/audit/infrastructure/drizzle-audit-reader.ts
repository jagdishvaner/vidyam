import { Injectable } from "@nestjs/common";
import type { AuditPage } from "@vidyam/contracts";
import { schema } from "@vidyam/db";
import { and, desc, eq, like, lt, or, type SQL } from "drizzle-orm";

import { OrgDatabase } from "../../../shared/database/org-database.js";
import { encodeCursor, type AuditReader, type Cursor } from "../application/read-audit-log.js";

const { auditLog, users } = schema;

@Injectable()
export class DrizzleAuditReader implements AuditReader {
  constructor(private readonly orgDb: OrgDatabase) {}

  page(
    orgId: string,
    filter: { action?: string; userId?: string },
    after: Cursor | null,
    size: number,
  ): Promise<AuditPage> {
    return this.orgDb.run(orgId, async (tx) => {
      const conditions: (SQL | undefined)[] = [];
      if (filter.action) {
        // "staff" means every staff action; "staff.update" means that one.
        conditions.push(
          filter.action.includes(".")
            ? eq(auditLog.action, filter.action)
            : like(auditLog.action, `${filter.action}.%`),
        );
      }
      if (filter.userId) conditions.push(eq(auditLog.userId, filter.userId));
      if (after) {
        const at = new Date(after.at);
        conditions.push(
          or(lt(auditLog.createdAt, at), and(eq(auditLog.createdAt, at), lt(auditLog.id, after.id))),
        );
      }
      const rows = await tx
        .select({ row: auditLog, name: users.name, email: users.email })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.userId))
        .where(and(...conditions))
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(size + 1);
      const page = rows.slice(0, size);
      const last = page.at(-1);
      return {
        entries: page.map(({ row, name, email }) => ({
          id: row.id,
          at: row.createdAt.toISOString(),
          actor: row.userId && name && email ? { id: row.userId, name, email } : null,
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          data: row.data,
        })),
        nextCursor:
          rows.length > size && last
            ? encodeCursor({ at: last.row.createdAt.toISOString(), id: last.row.id })
            : null,
      };
    });
  }
}
