/**
 * TypeScript half of the cross-language workflow contract test (ADR 0013). The Python AI engine's
 * tests/integration/test_workflow_contract.py runs it while its own worker polls <taskQueue>.
 * Usage: tsx scripts/workflow-contract-client.ts <taskQueue>. Prints the outcomes as JSON on the last line.
 */
import { ApplicationFailure, Client, Connection, WorkflowFailedError } from "@temporalio/client";
import { PingInput, PingResult, WORKFLOWS, workflowId } from "@vidyam/contracts";

const [taskQueue] = process.argv.slice(2);
if (!taskQueue) throw new Error("usage: workflow-contract-client.ts <taskQueue>");

const connection = await Connection.connect({ address: process.env.VIDYAM_TEMPORAL_ADDRESS! });
const client = new Client({ connection, namespace: process.env.VIDYAM_TEMPORAL_NAMESPACE! });
const orgId = crypto.randomUUID();
try {
  const input = PingInput.parse({ v: 1, orgId, requestedBy: null, message: "hello from node" });
  const result = PingResult.parse(
    await client.workflow.execute(WORKFLOWS.ping, {
      taskQueue,
      workflowId: workflowId(WORKFLOWS.ping, orgId),
      args: [input],
    }),
  );

  // Input from another schema version must fail for good, not retry.
  const bad = await client.workflow
    .execute(WORKFLOWS.ping, {
      taskQueue,
      workflowId: workflowId(WORKFLOWS.ping, orgId, "bad"),
      args: [{ v: 2 }],
    })
    .then(
      () => null,
      (error: unknown) => {
        if (!(error instanceof WorkflowFailedError) || !(error.cause instanceof ApplicationFailure))
          throw error;
        return {
          type: error.cause.type,
          nonRetryable: error.cause.nonRetryable,
          message: error.cause.message,
        };
      },
    );
  console.log(JSON.stringify({ orgId, result, bad }));
} finally {
  await connection.close();
}
