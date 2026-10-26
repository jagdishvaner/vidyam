import { createReadStream } from "node:fs";

import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

import type { OriginalStore } from "../application/import-source.js";

export class S3OriginalStore implements OriginalStore {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  async put(key: string, file: { path: string; mimeType: string; sizeBytes: number }): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(file.path),
        ContentType: file.mimeType,
        ContentLength: file.sizeBytes,
      }),
    );
  }
}
