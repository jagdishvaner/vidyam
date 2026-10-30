/**
 * Loaded first with `node --import @vidyam/telemetry/register main.js`, so the instrumented libraries are
 * patched before the service imports them (ES modules need the loader hook registered first). The service's
 * name comes from OTEL_SERVICE_NAME. Without an endpoint it does nothing at all.
 */
import { register } from "node:module";

import { localEnv, startTracing, tracingEndpoint } from "./index.js";

// No signal handlers here: they would stop Node's default exit for services without their own. The last
// few spans before a stop may be lost; that is all.
const env = localEnv();
if (tracingEndpoint(env)) {
  // Only the modules the instrumentations patch: wrapping every file is slow, and fails on some (tsx's).
  register("@opentelemetry/instrumentation/hook.mjs", import.meta.url, {
    data: { include: ["pg", "pg-pool", "ioredis", "express", "http", "https", "node:http", "node:https"] },
  });
  startTracing(env.OTEL_SERVICE_NAME ?? "vidyam", { env });
}
