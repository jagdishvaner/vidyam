import { Module, StandardSchemaValidationPipe, type DynamicModule } from "@nestjs/common";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";

import type { Env } from "./config/env.js";
import { EnvModule } from "./config/env.module.js";
import { DashboardModule } from "./modules/dashboard/dashboard.module.js";
import { IdentityModule } from "./modules/identity/identity.module.js";
import { LibraryModule } from "./modules/library/library.module.js";
import { SystemModule } from "./modules/system/system.module.js";
import { CacheModule } from "./shared/cache/cache.module.js";
import { DatabaseModule } from "./shared/database/database.module.js";
import { DomainErrorFilter } from "./shared/kernel/domain-error.filter.js";
import { TemporalModule } from "./shared/temporal/temporal.module.js";

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        EnvModule.forRoot(env),
        DatabaseModule,
        CacheModule,
        TemporalModule,
        IdentityModule,
        SystemModule,
        DashboardModule,
        LibraryModule,
      ],
      providers: [
        // Request bodies/queries are validated against the zod schema given in @Body({ schema }) etc.
        { provide: APP_PIPE, useValue: new StandardSchemaValidationPipe() },
        { provide: APP_FILTER, useClass: DomainErrorFilter },
      ],
    };
  }
}
