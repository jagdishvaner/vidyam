import type { AppendChatBlocksInput, SaveDocumentVersionInput } from "@vidyam/contracts";
import { ApplicationFailure } from "@temporalio/common";
import { describe, expect, it } from "vitest";

import { DomainError } from "../../shared/kernel/errors.js";
import type { ManageChats } from "../chat/application/manage-chats.js";
import type { CommitResults } from "../studio/application/commit-results.js";
import { ApiActivities } from "./api-activities.js";

const ORG = "0b6f2c1e-0000-4000-8000-000000000001";
const DOC = "0b6f2c1e-0000-4000-8000-000000000002";

function activities(saveVersion: (input: SaveDocumentVersionInput) => Promise<unknown>) {
  const results = { saveVersion, updateRun: async () => ({ status: "done" }) } as unknown as CommitResults;
  const chats = {
    appendFromWorkflow: async (input: AppendChatBlocksInput) => ({
      messageId: input.messageId,
      created: true,
    }),
  } as unknown as ManageChats;
  return new ApiActivities(results, chats).handlers();
}

const version = { v: 1, orgId: ORG, documentId: DOC, baseVersion: 0, content: {}, authorKind: "agent" };

describe("ApiActivities", () => {
  it("runs each activity on input checked against its contract", async () => {
    const seen: SaveDocumentVersionInput[] = [];
    const run = activities(async (input) => {
      seen.push(input);
      return { version: 1, created: true };
    });
    await expect(run.save_document_version!(version)).resolves.toEqual({ version: 1, created: true });
    expect(seen[0]).toMatchObject({ ops: [], authorId: null, chatMessageId: null }); // contract defaults
  });

  it("fails at once on what a retry can't fix, and lets Temporal retry the rest", async () => {
    const failing = (error: Error) =>
      activities(async () => Promise.reject(error)).save_document_version!(version);
    for (const [error, type] of [
      [new DomainError("changed", "conflict"), "Conflict"],
      [new DomainError("gone", "not_found"), "NotFound"],
    ] as const) {
      const failure = await failing(error).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(ApplicationFailure);
      expect(failure).toMatchObject({ type, nonRetryable: true });
    }
    const bad = await activities(async () => ({})).save_document_version!({
      ...version,
      baseVersion: -1,
    }).catch((e: unknown) => e);
    expect(bad).toMatchObject({ type: "InvalidPayload", nonRetryable: true });
    const hiccup = new Error("connection reset");
    await expect(failing(hiccup)).rejects.toBe(hiccup);
  });
});
