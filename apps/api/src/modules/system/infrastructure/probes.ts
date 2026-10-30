import { HeadBucketCommand, type S3Client } from "@aws-sdk/client-s3";
import type { Client } from "@temporalio/client";
import proto from "@temporalio/proto";
import { ServiceHealth } from "@vidyam/contracts";
import type { DatabaseHandle } from "@vidyam/db";
import { Redis } from "ioredis";

import { bucketName, type Env } from "../../../config/env.js";
import type { AiEngineHealthReader, DependencyProbe } from "../application/check-system-status.js";

export class PostgresProbe implements DependencyProbe {
  readonly name = "postgres";
  constructor(private readonly database: DatabaseHandle) {}

  async check(): Promise<string | null> {
    const { rows } = await this.database.pool.query<{ role: string }>("select current_user as role");
    return `connected as ${rows[0]?.role}`;
  }
}

export class ValkeyProbe implements DependencyProbe {
  private readonly client: Redis;

  constructor(
    readonly name: string,
    url: string,
  ) {
    this.client = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1_500,
    });
  }

  async check(): Promise<string | null> {
    if (this.client.status === "wait" || this.client.status === "end") await this.client.connect();
    await this.client.ping();
    const policy = (await this.client.config("GET", "maxmemory-policy")) as string[];
    return `maxmemory-policy=${policy[1]}`;
  }

  async close(): Promise<void> {
    this.client.disconnect();
  }
}

export class TemporalProbe implements DependencyProbe {
  readonly name = "temporal";
  constructor(private readonly client: Client) {}

  async check(signal: AbortSignal): Promise<string | null> {
    const namespace = this.client.options.namespace;
    await this.client.connection.withAbortSignal(signal, () =>
      this.client.workflowService.describeNamespace({ namespace }),
    );
    return `namespace ${namespace} ready`;
  }
}

/**
 * Whether any worker polls a queue the API hands work to: `api` (ADR 0017; without it finished work can't be
 * saved) or `render` (without it exports never finish).
 */
export class WorkerProbe implements DependencyProbe {
  constructor(
    private readonly client: Client,
    readonly name: string,
    private readonly taskQueue: string,
  ) {}

  async check(signal: AbortSignal): Promise<string | null> {
    const { pollers } = await this.client.connection.withAbortSignal(signal, () =>
      this.client.workflowService.describeTaskQueue({
        namespace: this.client.options.namespace,
        taskQueue: { name: this.taskQueue },
        // CommonJS: its namespace is the default export under ESM.
        taskQueueType: proto.temporal.api.enums.v1.TaskQueueType.TASK_QUEUE_TYPE_ACTIVITY,
      }),
    );
    if (!pollers?.length) throw new Error(`no worker polls the ${this.taskQueue} queue`);
    return `${pollers.length} worker(s) polling ${this.taskQueue}`;
  }
}

export class S3Probe implements DependencyProbe {
  readonly name = "s3";
  constructor(
    private readonly s3: S3Client,
    private readonly env: Env,
  ) {}

  async check(signal: AbortSignal): Promise<string | null> {
    const bucket = bucketName(this.env, "raw");
    await this.s3.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: signal });
    return `bucket ${bucket} reachable`;
  }
}

export class HttpAiEngineHealthReader implements AiEngineHealthReader {
  constructor(private readonly env: Env) {}

  async read(signal: AbortSignal): Promise<ServiceHealth> {
    const response = await fetch(`${this.env.VIDYAM_AI_INTERNAL_URL}/health`, {
      headers: { "x-vidyam-service-token": this.env.VIDYAM_AI_INTERNAL_TOKEN },
      signal,
    });
    if (!response.ok) throw new Error(`AI engine answered ${response.status}`);
    return ServiceHealth.parse(await response.json());
  }
}
