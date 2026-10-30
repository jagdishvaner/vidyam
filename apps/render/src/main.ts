import { NativeConnection, Worker } from "@temporalio/worker";
import { TASK_QUEUES } from "@vidyam/contracts";
import { createDatabase } from "@vidyam/db";

import { RenderExport } from "./application/render-export.js";
import { exportsBucket, loadEnv } from "./config/env.js";
import { DocxRenderer } from "./infrastructure/docx.js";
import { PdfRenderer } from "./infrastructure/pdf.js";
import { PostgresExportSource } from "./infrastructure/postgres-export-source.js";
import { createS3Client, S3FileStore } from "./infrastructure/s3-file-store.js";
import { renderActivities } from "./interface/activities.js";

/**
 * The render worker (plan v3 §3): polls the `render` task queue (or the queue named on the command line, for
 * tests) and renders exports. Prints "ready <queue>" once it polls; stops on SIGTERM or SIGINT.
 */
const env = loadEnv();
const taskQueue = process.argv[2] ?? TASK_QUEUES.render.name;
const database = createDatabase(env.VIDYAM_DATABASE_URL, { max: env.VIDYAM_RENDER_CONCURRENCY + 1 });
const pdf = new PdfRenderer();
const render = new RenderExport(
  new PostgresExportSource(database),
  { pdf, docx: new DocxRenderer() },
  new S3FileStore(createS3Client(env), exportsBucket(env)),
);

const connection = await NativeConnection.connect({ address: env.VIDYAM_TEMPORAL_ADDRESS });
const worker = await Worker.create({
  connection,
  namespace: env.VIDYAM_TEMPORAL_NAMESPACE,
  taskQueue,
  activities: renderActivities(render),
  maxConcurrentActivityTaskExecutions: env.VIDYAM_RENDER_CONCURRENCY,
});
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => worker.shutdown());
const running = worker.run();
let stopped = false;
running.catch(() => (stopped = true)); // reported below, when it is awaited
while (worker.getState() !== "RUNNING" && !stopped) await new Promise((resolve) => setTimeout(resolve, 50));
if (!stopped) console.log(`ready ${taskQueue}`);
try {
  await running;
} finally {
  await pdf.close();
  await connection.close();
  await database.pool.end();
}
