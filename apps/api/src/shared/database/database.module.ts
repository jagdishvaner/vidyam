import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { createDatabase, type DatabaseHandle } from "@vidyam/db";

import { ENV, type Env } from "../../config/env.js";
import { OrgDatabase } from "./org-database.js";
import { DATABASE } from "./tokens.js";

/** Connects as the restricted runtime role, so row-level security applies to every query. */
@Global()
@Module({
  providers: [
    { provide: DATABASE, inject: [ENV], useFactory: (env: Env) => createDatabase(env.VIDYAM_DATABASE_URL) },
    OrgDatabase,
  ],
  exports: [DATABASE, OrgDatabase],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.database.pool.end();
  }
}
