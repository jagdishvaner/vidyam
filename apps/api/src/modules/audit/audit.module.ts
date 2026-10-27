import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";

import { AuditInterceptor } from "../../shared/audit/audit.interceptor.js";
import { AuditTrail } from "../../shared/audit/audit-trail.js";
import { AUDIT_READER, ReadAuditLog } from "./application/read-audit-log.js";
import { DrizzleAuditReader } from "./infrastructure/drizzle-audit-reader.js";
import { AuditController } from "./interface/audit.controller.js";

/** Records every @Audit action (globally) and serves the log to admins. */
@Global()
@Module({
  controllers: [AuditController],
  providers: [
    AuditTrail,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    ReadAuditLog,
    { provide: AUDIT_READER, useClass: DrizzleAuditReader },
  ],
  exports: [AuditTrail],
})
export class AuditModule {}
