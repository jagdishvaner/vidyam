import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

import type { LogoStore } from "../application/manage-center.js";

export class S3LogoStore implements LogoStore {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    try {
      const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const bytes = await object.Body!.transformToByteArray();
      return { bytes, contentType: object.ContentType ?? "application/octet-stream" };
    } catch (error) {
      if (error instanceof NoSuchKey) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
