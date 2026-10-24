import { Module, StandardSchemaValidationPipe, type DynamicModule } from "@nestjs/common";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";

import type { Env } from "./config/env.js";
import { EnvModule } from "./config/env.module.js";
import { DashboardModule } from "./modules/dashboard/dashboard.module.js";
import { IdentityModule } from "./modules/identity/identity.module.js";
import { SystemModule } from "./modules/system/system.module.js";
import { DatabaseModule } from "./shared/database/database.module.js";
import { DomainErrorFilter } from "./shared/kernel/domain-error.filter.js";
import { QueueModule } from "./shared/queue/queue.module.js";

@Module({})
export class AppModule {
  /**
   * `queues: false` builds the app without BullMQ and Bull Board. The OpenAPI export uses it: Swagger only
   * reads controllers, and Bull Board needs a live HTTP adapter that Nest's preview mode doesn't create.
   */
  static forRoot(env: Env, options: { queues?: boolean } = {}): DynamicModule {
    const queues = options.queues ?? true;
    return {
      module: AppModule,
      imports: [
        EnvModule.forRoot(env),
        DatabaseModule,
        IdentityModule,
        ...(queues ? [QueueModule] : []),
        SystemModule,
        DashboardModule,
      ],
      providers: [
        // Request bodies/queries are validated against the zod schema given in @Body({ schema }) etc.
        { provide: APP_PIPE, useValue: new StandardSchemaValidationPipe() },
        { provide: APP_FILTER, useClass: DomainErrorFilter },
      ],
    };
  }
}
