import { Module } from "@nestjs/common";
import { AuthModule } from "@thallesp/nestjs-better-auth";
import type { DatabaseHandle } from "@vidyam/db";
import type { Redis } from "ioredis";

import { ENV, type Env } from "../../config/env.js";
import { CACHE_REDIS } from "../../shared/cache/cache.module.js";
import { DATABASE } from "../../shared/database/tokens.js";
import { GetCurrentUser, MEMBERSHIP_READER } from "./application/get-current-user.js";
import { createAuth } from "./infrastructure/better-auth.js";
import { DrizzleMembershipReader } from "./infrastructure/drizzle-membership-reader.js";
import { createSmtpMailer } from "./infrastructure/mailer.js";
import { valkeySecondaryStorage } from "./infrastructure/valkey-secondary-storage.js";
import { MeController } from "./interface/me.controller.js";

/** Composition root for identity. AuthModule also registers a global guard: routes need a session by default. */
@Module({
  imports: [
    AuthModule.forRootAsync({
      inject: [ENV, DATABASE, CACHE_REDIS],
      useFactory: (env: Env, database: DatabaseHandle, redis: Redis) => ({
        auth: createAuth({
          env,
          db: database.db,
          mailer: createSmtpMailer(env),
          cache: valkeySecondaryStorage(redis),
        }),
      }),
    }),
  ],
  controllers: [MeController],
  providers: [GetCurrentUser, { provide: MEMBERSHIP_READER, useClass: DrizzleMembershipReader }],
})
export class IdentityModule {}
