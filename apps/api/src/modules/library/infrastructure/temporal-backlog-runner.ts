import { WorkflowExecutionAlreadyStartedError, WorkflowNotFoundError, type Client } from "@temporalio/client";
import {
  AiTaskQueue,
  BacklogKind,
  WORKFLOWS,
  workflowId,
  type BacklogRun,
  type RunBacklogInput,
} from "@vidyam/contracts";

import type { BacklogRunner } from "../application/content-backlogs.js";

const STATUS: Record<string, BacklogRun["status"] | undefined> = {
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  TERMINATED: "failed",
  TIMED_OUT: "failed",
  CANCELLED: "failed",
};

/** One RunBacklog workflow per center and kind: its id is fixed, so a second start finds the running one. */
export class TemporalBacklogRunner implements BacklogRunner {
  constructor(
    private readonly client: Client,
    /** Tests run their own workers under a prefixed task queue. */
    private readonly taskQueue: string = AiTaskQueue.enum.ai,
  ) {}

  async runs(orgId: string): Promise<BacklogRun[]> {
    const runs = await Promise.all(
      BacklogKind.options.map(async (kind): Promise<BacklogRun | null> => {
        const id = workflowId(WORKFLOWS.runBacklog, orgId, kind);
        try {
          const run = await this.client.workflow.getHandle(id).describe();
          const status = STATUS[run.status.name];
          return status ? { kind, workflowId: id, status, startedAt: run.startTime.toISOString() } : null;
        } catch (error) {
          if (error instanceof WorkflowNotFoundError) return null;
          throw error;
        }
      }),
    );
    return runs.filter((run): run is BacklogRun => run !== null);
  }

  async start(input: RunBacklogInput): Promise<BacklogRun | null> {
    const id = workflowId(WORKFLOWS.runBacklog, input.orgId, input.kind);
    try {
      await this.client.workflow.start(WORKFLOWS.runBacklog, {
        taskQueue: this.taskQueue,
        workflowId: id,
        args: [input],
      });
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) return null;
      throw error;
    }
    return { kind: input.kind, workflowId: id, status: "running", startedAt: new Date().toISOString() };
  }
}
