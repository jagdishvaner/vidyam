import { Injectable } from "@nestjs/common";
import { ApplicationFailure } from "@temporalio/common";
import {
  API_ACTIVITIES,
  AppendChatBlocksInput,
  ApplyDocumentEditsInput,
  FinishExportInput,
  SaveDocumentVersionInput,
  UpdateGenerationRunInput,
} from "@vidyam/contracts";
import type { z } from "zod";

import { DomainError } from "../../shared/kernel/errors.js";
import { ManageChats } from "../chat/application/manage-chats.js";
import { CommitResults } from "../studio/application/commit-results.js";
import { ExportDocuments } from "../studio/application/export-documents.js";
import { ManageDocuments } from "../studio/application/manage-documents.js";

type Activity = (input: unknown) => Promise<unknown>;

/** Failures a retry can't fix are final: Temporal fails the activity at once instead of trying again. */
const FINAL: Partial<Record<DomainError["kind"], string>> = {
  invalid: "InvalidPayload",
  not_found: "NotFound",
  conflict: "Conflict",
  forbidden: "Forbidden",
};

function activity<S extends z.ZodType>(
  name: string,
  schema: S,
  run: (input: z.infer<S>) => Promise<unknown>,
): Activity {
  return async (raw) => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw ApplicationFailure.nonRetryable(
        `invalid ${name} input: ${parsed.error.message}`,
        "InvalidPayload",
      );
    }
    try {
      return await run(parsed.data);
    } catch (error) {
      if (error instanceof DomainError && FINAL[error.kind]) {
        throw ApplicationFailure.nonRetryable(error.message, FINAL[error.kind]);
      }
      throw error; // a database hiccup, say: Temporal retries
    }
  };
}

/**
 * The activities the API runs on the `api` task queue (ADR 0017): workflows in the AI engine call them by
 * name to commit results to the tables only the API writes. Inputs are checked against the contracts.
 */
@Injectable()
export class ApiActivities {
  constructor(
    private readonly results: CommitResults,
    private readonly chats: ManageChats,
    private readonly documents: ManageDocuments,
    private readonly exports: ExportDocuments,
  ) {}

  handlers(): Record<string, Activity> {
    return {
      [API_ACTIVITIES.saveDocumentVersion]: activity(
        API_ACTIVITIES.saveDocumentVersion,
        SaveDocumentVersionInput,
        (input) => this.results.saveVersion(input),
      ),
      [API_ACTIVITIES.updateGenerationRun]: activity(
        API_ACTIVITIES.updateGenerationRun,
        UpdateGenerationRunInput,
        (input) => this.results.updateRun(input),
      ),
      [API_ACTIVITIES.appendChatBlocks]: activity(
        API_ACTIVITIES.appendChatBlocks,
        AppendChatBlocksInput,
        (input) => this.chats.appendFromWorkflow(input),
      ),
      [API_ACTIVITIES.finishExport]: activity(API_ACTIVITIES.finishExport, FinishExportInput, (input) =>
        this.exports.finish(input),
      ),
      [API_ACTIVITIES.applyDocumentEdits]: activity(
        API_ACTIVITIES.applyDocumentEdits,
        ApplyDocumentEditsInput,
        (input) => this.documents.applyFromWorkflow(input),
      ),
    };
  }
}
