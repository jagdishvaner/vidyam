import { Module } from "@nestjs/common";
import { AuthModule } from "@thallesp/nestjs-better-auth";
import type { DatabaseHandle } from "@vidyam/db";

import { ENV, type Env } from "../../config/env.js";
import { DATABASE } from "../../shared/database/tokens.js";
import { GetCurrentUser, MEMBERSHIP_READER } from "./application/get-current-user.js";
import { createAuth } from "./infrastructure/better-auth.js";
import { DrizzleMembershipReader } from "./infrastructure/drizzle-membership-reader.js";
import { createSmtpMailer } from "./infrastructure/mailer.js";
import { MeController } from "./interface/me.controller.js";

/** Composition root for identity. AuthModule also registers a global guard: routes need a session by default. */
@Module({
  imports: [
    AuthModule.forRootAsync({
      inject: [ENV, DATABASE],
      useFactory: (env: Env, database: DatabaseHandle) => ({
        auth: createAuth({ env, db: database.db, mailer: createSmtpMailer(env) }),
      }),
    }),
  ],
  controllers: [MeController],
  providers: [GetCurrentUser, { provide: MEMBERSHIP_READER, useClass: DrizzleMembershipReader }],
})
export class IdentityModule {}
