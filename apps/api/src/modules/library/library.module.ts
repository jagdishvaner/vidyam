import { Module } from "@nestjs/common";
import type { DatabaseHandle } from "@vidyam/db";

import { bucketName, ENV, type Env } from "../../config/env.js";
import { DATABASE } from "../../shared/database/tokens.js";
import { createS3Client } from "../../shared/storage/s3.js";
import { BrowseLibrary, LIBRARY_READER } from "./application/browse-library.js";
import { ORIGINAL_STORE } from "./application/import-source.js";
import { RemoveSource, SOURCE_REMOVER } from "./application/remove-source.js";
import { DrizzleLibraryReader } from "./infrastructure/drizzle-library-reader.js";
import { DrizzleSourceRegistry } from "./infrastructure/drizzle-source-registry.js";
import { S3OriginalStore } from "./infrastructure/s3-original-store.js";
import { LibraryController } from "./interface/library.controller.js";

/** Composition root for the library. Files are imported with `pnpm ingest` for now (ADR 0012, 0014). */
@Module({
  controllers: [LibraryController],
  providers: [
    BrowseLibrary,
    RemoveSource,
    { provide: LIBRARY_READER, useClass: DrizzleLibraryReader },
    {
      provide: SOURCE_REMOVER,
      inject: [DATABASE],
      useFactory: (database: DatabaseHandle) => new DrizzleSourceRegistry(database),
    },
    {
      provide: ORIGINAL_STORE,
      inject: [ENV],
      useFactory: (env: Env) => new S3OriginalStore(createS3Client(env), bucketName(env, "raw")),
    },
  ],
})
export class LibraryModule {}
