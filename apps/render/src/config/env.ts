import path from "node:path";

import { z } from "zod";

/** Every variable the render worker reads. It refuses to start if one is missing or malformed. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  VIDYAM_DATABASE_URL: z.url(),
  /** host:port of the Temporal frontend (ADR 0013). */
  VIDYAM_TEMPORAL_ADDRESS: z.string().min(1),
  VIDYAM_TEMPORAL_NAMESPACE: z.string().default("vidyam"),
  /** Unset on AWS, where the SDK talks to real S3 with the task's IAM role. */
  VIDYAM_S3_ENDPOINT: z.url().optional(),
  VIDYAM_S3_REGION: z.string().min(1),
  VIDYAM_S3_ACCESS_KEY_ID: z.string().optional(),
  VIDYAM_S3_SECRET_ACCESS_KEY: z.string().optional(),
  VIDYAM_S3_BUCKET_PREFIX: z.string().min(1),
  /** Files rendered at once; each holds a Chromium page while it renders. */
  VIDYAM_RENDER_CONCURRENCY: z.coerce.number().int().positive().default(2),
});
export type Env = z.infer<typeof EnvSchema>;

/** Loads the repo-root .env for local runs (real environment variables win), then validates. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (source === process.env) {
    try {
      process.loadEnvFile(path.resolve(import.meta.dirname, "../../../../.env"));
    } catch {
      // No .env file: CI and AWS provide the environment directly.
    }
  }
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export function exportsBucket(env: Pick<Env, "VIDYAM_S3_BUCKET_PREFIX">): string {
  return `${env.VIDYAM_S3_BUCKET_PREFIX}-exports`;
}
