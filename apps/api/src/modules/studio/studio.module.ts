import { Module } from "@nestjs/common";
import type { Client } from "@temporalio/client";

import { bucketName, ENV, type Env } from "../../config/env.js";
import { createS3Client } from "../../shared/storage/s3.js";
import { TEMPORAL_CLIENT } from "../../shared/temporal/temporal.module.js";

import { CommitResults, STUDIO_STORE } from "./application/commit-results.js";
import {
  EXPORT_FILES,
  EXPORT_STARTER,
  EXPORT_STORE,
  ExportDocuments,
} from "./application/export-documents.js";
import { DOCUMENT_STORE, ManageDocuments } from "./application/manage-documents.js";
import { DrizzleDocumentStore } from "./infrastructure/drizzle-document-store.js";
import { DrizzleExportStore } from "./infrastructure/drizzle-export-store.js";
import { S3ExportFiles } from "./infrastructure/s3-export-files.js";
import { TemporalExportStarter } from "./infrastructure/temporal-export-starter.js";
import { DrizzleStudioStore } from "./infrastructure/drizzle-studio-store.js";
import { DocumentsController } from "./interface/documents.controller.js";

/**
 * Documents (plan v3 §7, steps 27–29): workflows commit what they make through CommitResults (ADR 0017),
 * teachers read, edit and undo them on the canvas, and export them as PDF or Word files.
 */
@Module({
  controllers: [DocumentsController],
  providers: [
    CommitResults,
    ManageDocuments,
    { provide: STUDIO_STORE, useClass: DrizzleStudioStore },
    { provide: DOCUMENT_STORE, useClass: DrizzleDocumentStore },
    ExportDocuments,
    { provide: EXPORT_STORE, useClass: DrizzleExportStore },
    {
      provide: EXPORT_STARTER,
      inject: [TEMPORAL_CLIENT],
      useFactory: (client: Client) => new TemporalExportStarter(client),
    },
    {
      provide: EXPORT_FILES,
      inject: [ENV],
      useFactory: (env: Env) => new S3ExportFiles(createS3Client(env), bucketName(env, "exports")),
    },
  ],
  exports: [CommitResults, ManageDocuments, ExportDocuments],
})
export class StudioModule {}
