import { localEnv, startTracing } from "./index.js";

/**
 * For a Next.js app's `register()` in `instrumentation.ts`, on the Node.js runtime only: Next traces its own
 * requests and rendering once a tracer is installed, and fetches to the API carry the trace on.
 */
export function startNextTracing(service: string): void {
  startTracing(service, { env: localEnv(), nextjs: true });
}
