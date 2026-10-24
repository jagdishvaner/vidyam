/** `pnpm bootstrap:s3`: create the buckets (idempotent) and allow browser uploads to the raw bucket. */
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

import { bucketName, loadEnv } from "../src/config/env.js";
import { createS3Client } from "../src/modules/system/infrastructure/probes.js";

const env = loadEnv();
const s3 = createS3Client(env);

async function ensureBucket(client: S3Client, bucket: string): Promise<"created" | "exists"> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return "exists";
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    return "created";
  }
}

for (const kind of ["raw", "derived", "exports", "embeddings"] as const) {
  const bucket = bucketName(env, kind);
  console.log(`${bucket}: ${await ensureBucket(s3, bucket)}`);
}

// Uploads go straight from the browser to S3 with presigned URLs (multi-GB videos never touch our servers).
await s3.send(
  new PutBucketCorsCommand({
    Bucket: bucketName(env, "raw"),
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: [env.VIDYAM_APP_URL],
          AllowedMethods: ["PUT", "POST", "GET", "HEAD"],
          AllowedHeaders: ["*"],
          ExposeHeaders: ["ETag"],
          MaxAgeSeconds: 3000,
        },
      ],
    },
  }),
);
console.log(`CORS on ${bucketName(env, "raw")}: allow ${env.VIDYAM_APP_URL}`);
