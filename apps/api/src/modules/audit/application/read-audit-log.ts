import { Inject, Injectable } from "@nestjs/common";
import type { AuditPage, AuditQuery } from "@vidyam/contracts";

import { DomainError } from "../../../shared/kernel/errors.js";

export const AUDIT_PAGE_SIZE = 50;

/** Port: the center's audit log, newest first, read a page at a time. */
export interface AuditReader {
  page(
    orgId: string,
    filter: { action?: string; userId?: string },
    after: Cursor | null,
    size: number,
  ): Promise<AuditPage>;
}
export const AUDIT_READER = Symbol("AUDIT_READER");

export interface Cursor {
  at: string;
  id: string;
}

export const encodeCursor = (cursor: Cursor) =>
  Buffer.from(`${cursor.at}|${cursor.id}`).toString("base64url");

function decodeCursor(value: string): Cursor {
  const [at, id] = Buffer.from(value, "base64url").toString().split("|");
  if (!at || !id || Number.isNaN(Date.parse(at)))
    throw new DomainError("That page link is not valid.", "invalid");
  return { at, id };
}

@Injectable()
export class ReadAuditLog {
  constructor(@Inject(AUDIT_READER) private readonly reader: AuditReader) {}

  execute(orgId: string, query: AuditQuery): Promise<AuditPage> {
    const after = query.cursor ? decodeCursor(query.cursor) : null;
    return this.reader.page(orgId, { action: query.action, userId: query.userId }, after, AUDIT_PAGE_SIZE);
  }
}
