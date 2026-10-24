import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { BullBoardModule } from "@bull-board/nestjs";
import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { AuthService } from "@thallesp/nestjs-better-auth";
import { QUEUE_PREFIX, QUEUES } from "@vidyam/contracts";
import { fromNodeHeaders } from "better-auth/node";
import type { NextFunction, Request, Response } from "express";
import { Redis } from "ioredis";

import { ENV, type Env } from "../../config/env.js";
import { PLATFORM_ADMIN } from "../../modules/identity/domain/roles.js";

const QUEUE_NAMES = Object.values(QUEUES).map((q) => q.name);

/** Bull Board is mounted outside Nest's guards, so it checks the Better Auth session itself. */
function platformAdminOnly(auth: AuthService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if ((session?.user as { role?: string } | undefined)?.role === PLATFORM_ADMIN) return next();
    res.status(session ? 403 : 401).send(session ? "Forbidden" : "Sign in required");
  };
}

/** Producers for every queue (BullMQ on valkey-queue) and the Bull Board UI at /api/admin/queues. */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        prefix: QUEUE_PREFIX,
        connection: new Redis(env.VIDYAM_QUEUE_REDIS_URL, { maxRetriesPerRequest: null }),
      }),
    }),
    BullModule.registerQueue(...QUEUE_NAMES.map((name) => ({ name }))),
    BullBoardModule.forRootAsync({
      inject: [AuthService],
      useFactory: (auth: AuthService) => ({
        route: "/admin/queues", // the global "api" prefix is added by Nest
        adapter: ExpressAdapter,
        middleware: platformAdminOnly(auth),
      }),
    }),
    BullBoardModule.forFeature(...QUEUE_NAMES.map((name) => ({ name, adapter: BullMQAdapter }))),
  ],
  exports: [BullModule],
})
export class QueueModule {}
