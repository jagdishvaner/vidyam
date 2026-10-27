import {
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { UserSession } from "@thallesp/nestjs-better-auth";
import { concatMap, from, map, type Observable } from "rxjs";

import { AUDIT, redact, type AuditSpec } from "./audit.js";
import { AuditTrail } from "./audit-trail.js";

/**
 * After a successful @Audit handler, records who did what to which record. The write happens before the response
 * is sent, so an action that can't be recorded is reported as failed rather than silently unaudited.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly trail: AuditTrail,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const spec = this.reflector.get<AuditSpec | undefined>(AUDIT, context.getHandler());
    if (!spec) return next.handle();
    const request = context.switchToHttp().getRequest<{
      params: Record<string, string>;
      body: unknown;
      session?: UserSession;
    }>();
    return next
      .handle()
      .pipe(concatMap((result) => from(this.record(spec, request, result)).pipe(map(() => result))));
  }

  private async record(
    spec: AuditSpec,
    request: { params: Record<string, string>; body: unknown; session?: UserSession },
    result: unknown,
  ): Promise<void> {
    const session = request.session;
    const orgId = (session?.session as { activeOrganizationId?: string } | undefined)?.activeOrganizationId;
    if (!session || !orgId) {
      this.logger.warn(`${spec.action}: no active organization to record it under`);
      return;
    }
    const auditContext = { params: request.params, body: request.body, result };
    const params = Object.values(request.params);
    await this.trail.record({
      orgId,
      userId: session.user.id,
      action: spec.action,
      entityType: spec.entityType,
      entityId: spec.entityId?.(auditContext) ?? (params.length === 1 ? params[0]! : "-"),
      data: spec.data ? spec.data(auditContext) : redact(request.body ?? {}),
    });
  }
}
