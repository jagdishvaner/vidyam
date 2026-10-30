import { DeleteObjectCommand, GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";

import type { ExportFiles } from "../application/export-documents.js";

/** The exports bucket, read whole: exports are a few megabytes at most. */
export class S3ExportFiles implements ExportFiles {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  async read(key: string): Promise<Uint8Array> {
    const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return object.Body!.transformToByteArray();
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
