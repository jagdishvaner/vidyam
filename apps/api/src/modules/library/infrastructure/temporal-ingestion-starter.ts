import { WorkflowExecutionAlreadyStartedError, type Client } from "@temporalio/client";
import {
  AiTaskQueue,
  IngestSourceResult,
  WORKFLOWS,
  workflowId,
  type IngestSourceInput,
} from "@vidyam/contracts";

import type { IngestionStarter } from "../application/import-source.js";

export class TemporalIngestionStarter implements IngestionStarter {
  constructor(
    private readonly client: Client,
    /** Tests run their own workers under a prefixed task queue. */
    private readonly taskQueue: string = AiTaskQueue.enum.ai,
  ) {}

  async start(input: IngestSourceInput): Promise<boolean> {
    try {
      await this.client.workflow.start(WORKFLOWS.ingestSource, {
        taskQueue: this.taskQueue,
        workflowId: workflowId(WORKFLOWS.ingestSource, input.sourceId),
        args: [input],
      });
      return true;
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) return false;
      throw error;
    }
  }

  /** Waits for a source's ingestion to finish (used by `pnpm ingest --wait`). */
  async result(sourceId: string): Promise<IngestSourceResult> {
    const handle = this.client.workflow.getHandle(workflowId(WORKFLOWS.ingestSource, sourceId));
    return IngestSourceResult.parse(await handle.result());
  }
}
