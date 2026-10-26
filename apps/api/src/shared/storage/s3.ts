import { S3Client } from "@aws-sdk/client-s3";

import type { Env } from "../../config/env.js";

/** SeaweedFS locally (path-style, static keys); real S3 with the task's IAM role on AWS. */
export function createS3Client(env: Env): S3Client {
  return new S3Client({
    region: env.VIDYAM_S3_REGION,
    endpoint: env.VIDYAM_S3_ENDPOINT,
    forcePathStyle: Boolean(env.VIDYAM_S3_ENDPOINT),
    credentials:
      env.VIDYAM_S3_ACCESS_KEY_ID && env.VIDYAM_S3_SECRET_ACCESS_KEY
        ? { accessKeyId: env.VIDYAM_S3_ACCESS_KEY_ID, secretAccessKey: env.VIDYAM_S3_SECRET_ACCESS_KEY }
        : undefined,
  });
}
