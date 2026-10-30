import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Client, Connection } from "@temporalio/client";
import { OpenTelemetryWorkflowClientInterceptor } from "@temporalio/interceptors-opentelemetry";

import { ENV, type Env } from "../../config/env.js";

export const TEMPORAL_CLIENT = Symbol("TEMPORAL_CLIENT");

/**
 * Starts and queries durable workflows on Temporal (ADR 0013); the Python AI engine runs them. The connection
 * opens on first use, so the API boots (and reports Temporal as down) while Temporal is unavailable. Starting a
 * workflow carries the request's trace into it (ADR 0025); without tracing that costs nothing.
 */
@Global()
@Module({
  providers: [
    {
      provide: TEMPORAL_CLIENT,
      inject: [ENV],
      useFactory: (env: Env) =>
        new Client({
          connection: Connection.lazy({ address: env.VIDYAM_TEMPORAL_ADDRESS }),
          namespace: env.VIDYAM_TEMPORAL_NAMESPACE,
          interceptors: { workflow: [new OpenTelemetryWorkflowClientInterceptor()] },
        }),
    },
  ],
  exports: [TEMPORAL_CLIENT],
})
export class TemporalModule implements OnApplicationShutdown {
  constructor(@Inject(TEMPORAL_CLIENT) private readonly client: Client) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.connection.close();
  }
}
