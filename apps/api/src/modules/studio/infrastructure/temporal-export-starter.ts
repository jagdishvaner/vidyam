import { WorkflowExecutionAlreadyStartedError, type Client } from "@temporalio/client";
import { AiTaskQueue, WORKFLOWS, workflowId, type ExportDocumentInput } from "@vidyam/contracts";

import type { ExportStarter } from "../application/export-documents.js";

/** Starts ExportDocument on the AI engine's queue; the export's id names the workflow. */
export class TemporalExportStarter implements ExportStarter {
  constructor(
    private readonly client: Client,
    /** Tests run their own workers under a prefixed task queue. */
    private readonly taskQueue: string = AiTaskQueue.enum.ai,
  ) {}

  async start(input: ExportDocumentInput): Promise<void> {
    try {
      await this.client.workflow.start(WORKFLOWS.exportDocument, {
        taskQueue: this.taskQueue,
        workflowId: workflowId(WORKFLOWS.exportDocument, input.exportId),
        args: [input],
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }
}
