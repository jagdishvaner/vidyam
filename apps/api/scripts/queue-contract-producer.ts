/**
 * Producer half of the cross-language queue contract test (ADR 0005); the Python AI engine's
 * tests/integration/test_queue_contract.py runs it. Usage: tsx scripts/queue-contract-producer.ts <prefix> <queue>
 * Prints the created job ids as JSON on the last line.
 */
import { jobId, PingJob } from "@vidyam/contracts";
import { FlowProducer, Queue } from "bullmq";
import { Redis } from "ioredis";

const [prefix, queueName] = process.argv.slice(2);
if (!prefix || !queueName) throw new Error("usage: queue-contract-producer.ts <prefix> <queue>");

const connection = new Redis(process.env.VIDYAM_QUEUE_REDIS_URL!, { maxRetriesPerRequest: null });
const orgId = crypto.randomUUID();
const ping = (message: string) =>
  PingJob.parse({ v: 1, kind: "ping", orgId, requestedBy: null, traceparent: null, message });

const flows = new FlowProducer({ connection, prefix });
const queue = new Queue(queueName, { connection, prefix });
try {
  // A parent runs only after all of its children have completed.
  const tree = await flows.add({
    name: "ping",
    queueName,
    data: ping("parent"),
    opts: { jobId: jobId("ping", orgId, "parent") },
    children: ["child-1", "child-2"].map((message) => ({
      name: "ping",
      queueName,
      data: ping(message),
      opts: { jobId: jobId("ping", orgId, message) },
    })),
  });
  // A payload from a future/older schema version must fail permanently, not be retried.
  const bad = await queue.add(
    "ping",
    { v: 2, kind: "ping" },
    { jobId: jobId("ping", orgId, "bad"), attempts: 3 },
  );
  console.log(
    JSON.stringify({
      orgId,
      parent: tree.job.id,
      children: (tree.children ?? []).map((child) => child.job.id),
      bad: bad.id,
    }),
  );
} finally {
  await flows.close();
  await queue.close();
  connection.disconnect();
}
