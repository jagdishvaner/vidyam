import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import type { Client } from "@temporalio/client";
import { TASK_QUEUES } from "@vidyam/contracts";
import type { DatabaseHandle } from "@vidyam/db";
import type { Redis } from "ioredis";

import { ENV, type Env } from "../../config/env.js";
import { CACHE_REDIS } from "../../shared/cache/cache.module.js";
import { DATABASE } from "../../shared/database/tokens.js";
import { createS3Client } from "../../shared/storage/s3.js";
import { TEMPORAL_CLIENT } from "../../shared/temporal/temporal.module.js";
import {
  AI_ENGINE_HEALTH,
  CheckSystemStatus,
  DEPENDENCY_PROBES,
  type DependencyProbe,
} from "./application/check-system-status.js";
import { ListProblems, PROBLEM_STORE } from "./application/list-problems.js";
import { ALERT_SENDER, ALERT_STATE, ProblemAlerts } from "./application/problem-alerts.js";
import { ValkeyAlertState, WebhookAlertSender } from "./infrastructure/alert-delivery.js";
import { DrizzleProblemStore } from "./infrastructure/drizzle-problem-store.js";
import {
  HttpAiEngineHealthReader,
  PostgresProbe,
  S3Probe,
  TemporalProbe,
  ValkeyProbe,
  WorkerProbe,
} from "./infrastructure/probes.js";
import { SystemController } from "./interface/system.controller.js";

/** The API's own dependencies, and what went wrong lately. Qdrant is not one: only the AI engine talks to it (ADR 0003). */
@Module({
  controllers: [SystemController],
  providers: [
    CheckSystemStatus,
    {
      provide: DEPENDENCY_PROBES,
      inject: [ENV, DATABASE, TEMPORAL_CLIENT],
      useFactory: (env: Env, database: DatabaseHandle, temporal: Client): DependencyProbe[] => [
        new PostgresProbe(database),
        new TemporalProbe(temporal),
        new WorkerProbe(temporal, "api-worker", TASK_QUEUES.api.name),
        new WorkerProbe(temporal, "render-worker", TASK_QUEUES.render.name),
        new ValkeyProbe("valkey-cache", env.VIDYAM_CACHE_REDIS_URL),
        new S3Probe(createS3Client(env), env),
      ],
    },
    { provide: AI_ENGINE_HEALTH, inject: [ENV], useFactory: (env: Env) => new HttpAiEngineHealthReader(env) },
    ListProblems,
    ProblemAlerts,
    { provide: PROBLEM_STORE, useClass: DrizzleProblemStore },
    {
      provide: ALERT_STATE,
      inject: [CACHE_REDIS],
      useFactory: (redis: Redis) => new ValkeyAlertState(redis),
    },
    {
      provide: ALERT_SENDER,
      inject: [ENV],
      useFactory: (env: Env) =>
        env.VIDYAM_ALERT_WEBHOOK_URL ? new WebhookAlertSender(env.VIDYAM_ALERT_WEBHOOK_URL) : null,
    },
  ],
  exports: [ProblemAlerts],
})
export class SystemModule implements OnApplicationShutdown {
  constructor(@Inject(DEPENDENCY_PROBES) private readonly probes: DependencyProbe[]) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.probes.map((p) => (p instanceof ValkeyProbe ? p.close() : undefined)));
  }
}
