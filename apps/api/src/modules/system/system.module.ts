import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import type { Client } from "@temporalio/client";
import type { DatabaseHandle } from "@vidyam/db";

import { ENV, type Env } from "../../config/env.js";
import { DATABASE } from "../../shared/database/tokens.js";
import { TEMPORAL_CLIENT } from "../../shared/temporal/temporal.module.js";
import {
  AI_ENGINE_HEALTH,
  CheckSystemStatus,
  DEPENDENCY_PROBES,
  type DependencyProbe,
} from "./application/check-system-status.js";
import {
  createS3Client,
  HttpAiEngineHealthReader,
  PostgresProbe,
  S3Probe,
  TemporalProbe,
  ValkeyProbe,
} from "./infrastructure/probes.js";
import { SystemController } from "./interface/system.controller.js";

/** The API's own dependencies. Qdrant is not one: only the AI engine talks to it (ADR 0003). */
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
        new ValkeyProbe("valkey-cache", env.VIDYAM_CACHE_REDIS_URL),
        new S3Probe(createS3Client(env), env),
      ],
    },
    { provide: AI_ENGINE_HEALTH, inject: [ENV], useFactory: (env: Env) => new HttpAiEngineHealthReader(env) },
  ],
})
export class SystemModule implements OnApplicationShutdown {
  constructor(@Inject(DEPENDENCY_PROBES) private readonly probes: DependencyProbe[]) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.probes.map((p) => (p instanceof ValkeyProbe ? p.close() : undefined)));
  }
}
