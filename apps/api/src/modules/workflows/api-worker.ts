import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { NativeConnection, Worker } from "@temporalio/worker";
import { TASK_QUEUES } from "@vidyam/contracts";

import { ENV, type Env } from "../../config/env.js";
import { ApiActivities } from "./api-activities.js";

const RETRY_MS = 10_000;

/**
 * The API's Temporal worker (ADR 0017): polls the `api` task queue and runs the activities that commit
 * workflow results. Started by the API's main process only (not by scripts); while Temporal is unreachable
 * it keeps trying in the background, so the API itself still starts.
 */
@Injectable()
export class ApiWorker implements OnApplicationShutdown {
  private readonly logger = new Logger(ApiWorker.name);
  private worker: Worker | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly activities: ApiActivities,
  ) {}

  /** `taskQueue`: `api`, or a prefixed copy for tests. */
  start(taskQueue: string = TASK_QUEUES.api.name): void {
    this.running ??= this.loop(taskQueue);
  }

  /** Resolves once the worker polls its queue (tests wait for it before starting workflows). */
  async ready(timeoutMs = 30_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (this.worker?.getState() !== "RUNNING") {
      if (Date.now() > until) throw new Error("the API worker didn't start");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.worker?.getState() === "RUNNING") this.worker.shutdown();
    await this.running;
  }

  private async loop(taskQueue: string): Promise<void> {
    while (!this.stopped) {
      try {
        const connection = await NativeConnection.connect({ address: this.env.VIDYAM_TEMPORAL_ADDRESS });
        try {
          this.worker = await Worker.create({
            connection,
            namespace: this.env.VIDYAM_TEMPORAL_NAMESPACE,
            taskQueue,
            activities: this.activities.handlers(),
          });
          this.logger.log(`polling the ${taskQueue} task queue`);
          await this.worker.run(); // until shutdown
        } finally {
          await connection.close();
        }
      } catch (error) {
        if (this.stopped) break;
        this.logger.warn(`not polling ${taskQueue}: ${String(error)}; trying again in ${RETRY_MS / 1000}s`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    }
  }
}
