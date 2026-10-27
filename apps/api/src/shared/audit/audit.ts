import { SetMetadata } from "@nestjs/common";
import type { AuditAction } from "@vidyam/contracts";

export interface AuditContext {
  params: Record<string, string>;
  body: unknown;
  result: unknown;
}

export interface AuditSpec {
  action: AuditAction;
  entityType: string;
  /** Which record changed; defaults to the route's only parameter. */
  entityId?: (context: AuditContext) => string | undefined;
  /** What to keep; defaults to the request body with secrets removed. */
  data?: (context: AuditContext) => Record<string, unknown>;
}

export const AUDIT = Symbol("vidyam:audit");

/** Records this admin action in the audit log once it succeeds (see AuditInterceptor). */
export const Audit = (spec: AuditSpec) => SetMetadata(AUDIT, spec);

const SECRET = /pass(word)?|secret|token|api_?key|credential/i;
const MAX_BYTES = 4000;

/** Never store secrets; keep big payloads (whole syllabus files) as a short note instead. */
export function redact(value: unknown): Record<string, unknown> {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, inner]) => [
          k,
          SECRET.test(k) ? "[removed]" : strip(inner),
        ]),
      );
    }
    return v;
  };
  const clean = strip(value);
  const record =
    clean && typeof clean === "object" && !Array.isArray(clean)
      ? (clean as Record<string, unknown>)
      : { value: clean };
  if (JSON.stringify(record).length <= MAX_BYTES) return record;
  return { truncated: true, fields: Object.keys(record) };
}
