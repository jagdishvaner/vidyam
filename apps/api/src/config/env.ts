import path from "node:path";

import { z } from "zod";

/** Every variable the API reads. The process refuses to start if one is missing or malformed. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  VIDYAM_APP_URL: z.url(),
  VIDYAM_API_HOST: z.string().default("127.0.0.1"),
  VIDYAM_API_PORT: z.coerce.number().int().positive().default(38110),
  VIDYAM_DATABASE_URL: z.url(),
  VIDYAM_QUEUE_REDIS_URL: z.url(),
  VIDYAM_CACHE_REDIS_URL: z.url(),
  /** Unset on AWS, where the SDK talks to real S3 with the task's IAM role. */
  VIDYAM_S3_ENDPOINT: z.url().optional(),
  VIDYAM_S3_REGION: z.string().min(1),
  VIDYAM_S3_ACCESS_KEY_ID: z.string().optional(),
  VIDYAM_S3_SECRET_ACCESS_KEY: z.string().optional(),
  VIDYAM_S3_BUCKET_PREFIX: z.string().min(1),
  VIDYAM_SMTP_URL: z.string().min(1),
  VIDYAM_MAIL_FROM: z.string().default("Vidyam <noreply@vidyam.local>"),
  VIDYAM_AUTH_SECRET: z.string().min(32, "VIDYAM_AUTH_SECRET must be at least 32 characters"),
  VIDYAM_AI_INTERNAL_URL: z.url(),
  VIDYAM_AI_INTERNAL_TOKEN: z.string().min(16),
});
export type Env = z.infer<typeof EnvSchema>;

export const ENV = Symbol("ENV");

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
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export function bucketName(
  env: Pick<Env, "VIDYAM_S3_BUCKET_PREFIX">,
  kind: "raw" | "derived" | "exports" | "embeddings",
) {
  return `${env.VIDYAM_S3_BUCKET_PREFIX}-${kind}`;
}
