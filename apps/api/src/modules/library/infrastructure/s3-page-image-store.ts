import { DeleteObjectsCommand, ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";

import type { PageImageStore } from "../application/remove-source.js";

/** Page images live in the derived bucket at `org/<org>/pages/<source>/<page>.png` (written by the AI engine). */
export class S3PageImageStore implements PageImageStore {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  async deleteAll(orgId: string, sourceId: string): Promise<void> {
    const prefix = `org/${orgId}/pages/${sourceId}/`;
    let token: string | undefined;
    do {
      const listed = await this.s3.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      const keys = (listed.Contents ?? []).flatMap((item) => (item.Key ? [{ Key: item.Key }] : []));
      if (keys.length) {
        await this.s3.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys } }));
      }
      token = listed.NextContinuationToken;
    } while (token);
  }
}
