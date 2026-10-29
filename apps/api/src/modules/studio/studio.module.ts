import { Module } from "@nestjs/common";

import { CommitResults, STUDIO_STORE } from "./application/commit-results.js";
import { DOCUMENT_STORE, ManageDocuments } from "./application/manage-documents.js";
import { DrizzleDocumentStore } from "./infrastructure/drizzle-document-store.js";
import { DrizzleStudioStore } from "./infrastructure/drizzle-studio-store.js";
import { DocumentsController } from "./interface/documents.controller.js";

/**
 * Documents (plan v3 §7, step 27): workflows commit what they make through CommitResults (ADR 0017), and
 * teachers read, edit and undo them on the canvas.
 */
@Module({
  controllers: [DocumentsController],
  providers: [
    CommitResults,
    ManageDocuments,
    { provide: STUDIO_STORE, useClass: DrizzleStudioStore },
    { provide: DOCUMENT_STORE, useClass: DrizzleDocumentStore },
  ],
  exports: [CommitResults],
})
export class StudioModule {}
