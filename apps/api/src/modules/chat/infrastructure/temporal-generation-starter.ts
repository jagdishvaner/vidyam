import { WorkflowExecutionAlreadyStartedError, type Client } from "@temporalio/client";
import {
  AiTaskQueue,
  WORKFLOWS,
  workflowId,
  type EditDocumentInput,
  type GenerateDocumentInput,
  type TaskKind,
} from "@vidyam/contracts";

import type { GenerationStarter } from "../application/ports.js";

/** Starts GeneratePaper, GenerateNotes or EditDocument on the AI engine's queue; the run's id names the workflow. */
export class TemporalGenerationStarter implements GenerationStarter {
  constructor(
    private readonly client: Client,
    /** Tests run their own workers under a prefixed task queue. */
    private readonly taskQueue: string = AiTaskQueue.enum.ai,
  ) {}

  async start(input: GenerateDocumentInput, kind: TaskKind): Promise<void> {
    const type =
      kind === "question_paper" || kind === "worksheet" ? WORKFLOWS.generatePaper : WORKFLOWS.generateNotes;
    try {
      await this.client.workflow.start(type, {
        taskQueue: this.taskQueue,
        workflowId: workflowId(type, input.runId),
        args: [input],
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }

  async startEdit(input: EditDocumentInput): Promise<void> {
    try {
      await this.client.workflow.start(WORKFLOWS.editDocument, {
        taskQueue: this.taskQueue,
        workflowId: workflowId(WORKFLOWS.editDocument, input.runId),
        args: [input],
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    }
  }
}
