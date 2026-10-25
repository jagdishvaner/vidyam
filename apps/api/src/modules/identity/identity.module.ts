import { Module } from "@nestjs/common";
import { AuthModule } from "@thallesp/nestjs-better-auth";
import type { DatabaseHandle } from "@vidyam/db";
import type { Redis } from "ioredis";

import { ENV, type Env } from "../../config/env.js";
import { CACHE_REDIS } from "../../shared/cache/cache.module.js";
import { DATABASE } from "../../shared/database/tokens.js";
import { GetCurrentUser, MEMBERSHIP_READER } from "./application/get-current-user.js";
import { AddMember, MEMBER_ACCOUNTS, RemoveMember, SetMemberPassword } from "./application/manage-members.js";
import { createAuth } from "./infrastructure/better-auth.js";
import { BetterAuthMemberAccounts } from "./infrastructure/better-auth-member-accounts.js";
import { DrizzleMembershipReader } from "./infrastructure/drizzle-membership-reader.js";
import { valkeySecondaryStorage } from "./infrastructure/valkey-secondary-storage.js";
import { MeController } from "./interface/me.controller.js";
import { MembersController } from "./interface/members.controller.js";

/** Composition root for identity. AuthModule also registers a global guard: routes need a session by default. */
@Module({
  imports: [
    AuthModule.forRootAsync({
      inject: [ENV, DATABASE, CACHE_REDIS],
      useFactory: (env: Env, database: DatabaseHandle, redis: Redis) => ({
        auth: createAuth({ env, db: database.db, cache: valkeySecondaryStorage(redis) }),
      }),
    }),
  ],
  controllers: [MeController, MembersController],
  providers: [
    GetCurrentUser,
    AddMember,
    SetMemberPassword,
    RemoveMember,
    { provide: MEMBERSHIP_READER, useClass: DrizzleMembershipReader },
    { provide: MEMBER_ACCOUNTS, useClass: BetterAuthMemberAccounts },
  ],
})
export class IdentityModule {}
