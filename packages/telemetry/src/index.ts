import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import type { Instrumentation } from "@opentelemetry/instrumentation";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { IORedisInstrumentation } from "@opentelemetry/instrumentation-ioredis";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";

/**
 * The environment with the repo-root .env underneath it (real variables win), read without changing
 * `process.env`: local runs keep the tracing endpoint there. CI and AWS have no .env file.
 */
export function localEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  try {
    const file = readFileSync(path.resolve(import.meta.dirname, "../../../.env"), "utf8");
    return { ...parseEnv(file), ...env };
  } catch {
    return env;
  }
}

/** Where spans go (OTLP/HTTP): the standard variable, or Vidyam's own. Unset means tracing is off. */
export function tracingEndpoint(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.OTEL_EXPORTER_OTLP_ENDPOINT || env.VIDYAM_OTEL_ENDPOINT || null;
}

export interface TracingOptions {
  env?: NodeJS.ProcessEnv;
  /** A Next.js server traces its own requests and rendering; only its outgoing fetches are added. */
  nextjs?: boolean;
}

/**
 * Tracing for a Node service (plan v3 step 31): its incoming and outgoing HTTP (fetch too), Express routes,
 * Postgres and Valkey, exported over OTLP/HTTP. Trace headers carry the trace on to the other services; the
 * Temporal interceptors carry it through workflows. Returns null, and does nothing, without an endpoint.
 */
export function startTracing(service: string, options: TracingOptions = {}): NodeSDK | null {
  const env = options.env ?? process.env;
  const endpoint = tracingEndpoint(env);
  if (!endpoint) return null;
  const instrumentations: Instrumentation[] = options.nextjs
    ? [new UndiciInstrumentation()]
    : [
        new HttpInstrumentation({
          // Health checks every few seconds would bury the requests that matter.
          ignoreIncomingRequestHook: (request) => /\/(health|livez)\b/.test(request.url ?? ""),
        }),
        new UndiciInstrumentation(),
        new ExpressInstrumentation(),
        new PgInstrumentation(),
        new IORedisInstrumentation(),
      ];
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      "service.name": service,
      "service.namespace": "vidyam",
      "deployment.environment": env.NODE_ENV ?? "development",
    }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, "")}/v1/traces` }),
    instrumentations,
  });
  sdk.start();
  return sdk;
}
