/** Tracing (ADR 0025), on the Node.js runtime and only when an OTLP endpoint is configured. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startNextTracing } = await import("@vidyam/telemetry/next");
    startNextTracing("vidyam-admin");
  }
}
