/**
 * The paid backlogs (plan v3 §5, §8): reading scanned pages (OCR), splitting question papers into questions,
 * and picking syllabus topics. Nothing runs without its estimate being shown first.
 *
 *   pnpm backlog                                  what each backlog holds and what running it would cost
 *   pnpm backlog <ocr|segment|tag> --run          run one (Batch API: results within minutes to hours)
 *       --limit N   at most N items this time        --wait   wait for it and show what it did
 *
 *   --org <slug>   organization (default: the only one, if there is one)
 */
import { parseArgs } from "node:util";

import { Client, Connection } from "@temporalio/client";
import { BacklogKind, RunBacklogResult, type BacklogEstimate } from "@vidyam/contracts";
import { createDatabase, schema } from "@vidyam/db";

import { loadEnv } from "../src/config/env.js";
import { ContentBacklogs } from "../src/modules/library/application/content-backlogs.js";
import { HttpBacklogEstimator } from "../src/modules/library/infrastructure/http-backlog-estimator.js";
import { TemporalBacklogRunner } from "../src/modules/library/infrastructure/temporal-backlog-runner.js";
import { DomainError } from "../src/shared/kernel/errors.js";

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    run: { type: "boolean", default: false },
    limit: { type: "string" },
    wait: { type: "boolean", default: false },
    org: { type: "string" },
    "task-queue": { type: "string" },
  },
});

function fail(message: string): never {
  console.error(`backlog: ${message}`);
  process.exit(1);
}

const NAMES: Record<BacklogKind, { title: string; unit: string }> = {
  ocr: { title: "Read scanned pages (OCR)", unit: "page" },
  segment: { title: "Split papers into questions", unit: "paper" },
  tag: { title: "Pick syllabus topics", unit: "item" },
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const kind = positionals[0] === undefined ? null : BacklogKind.safeParse(positionals[0]);
if (kind && !kind.success) fail(`choose one of: ${BacklogKind.options.join(", ")}`);
if (options.run && !kind) fail("say which backlog to run: pnpm backlog ocr --run");
const limit = options.limit === undefined ? null : Number(options.limit);
if (limit !== null && !(Number.isInteger(limit) && limit > 0)) fail("--limit takes a positive whole number");

const env = loadEnv();
const database = createDatabase(env.VIDYAM_DATABASE_URL, { max: 1 });
const connection = await Connection.connect({ address: env.VIDYAM_TEMPORAL_ADDRESS });
const client = new Client({ connection, namespace: env.VIDYAM_TEMPORAL_NAMESPACE });
const backlogs = new ContentBacklogs(
  new HttpBacklogEstimator(env),
  new TemporalBacklogRunner(client, options["task-queue"]),
);

function describe(estimate: BacklogEstimate): string {
  const { title, unit } = NAMES[estimate.kind];
  const who = estimate.modelId ? `${estimate.modelId} via ${estimate.provider}` : "";
  const cost = `US$${estimate.costUsd.toFixed(2)}`;
  const line = `${title.padEnd(30)} ${plural(estimate.items, unit).padEnd(12)} ${plural(estimate.requests, "request").padEnd(14)} ${who.padEnd(34)} ${cost}`;
  return estimate.blocked ? `${line}\n${" ".repeat(31)}can't run: ${estimate.blocked}` : line;
}

try {
  const organizations = await database.db
    .select({ id: schema.organizations.id, slug: schema.organizations.slug, name: schema.organizations.name })
    .from(schema.organizations);
  const org = options.org
    ? organizations.find((o) => o.slug === options.org)
    : organizations.length === 1
      ? organizations[0]
      : undefined;
  if (!org) fail(`choose an organization with --org: ${organizations.map((o) => o.slug).join(", ")}`);

  const overview = await backlogs.overview(org.id);
  if (!overview.reachable) fail("the AI engine can't be reached; is `pnpm dev` (or the stack) running?");
  const shown = kind?.success ? overview.backlogs.filter((b) => b.kind === kind.data) : overview.backlogs;
  console.log(`Backlogs of ${org.name}, at Batch API prices:`);
  for (const estimate of shown) console.log(`  ${describe(estimate)}`);
  for (const run of overview.runs.filter((r) => r.status === "running")) {
    console.log(`  running now: ${NAMES[run.kind].title} (started ${run.startedAt})`);
  }

  if (options.run && kind?.success) {
    const started = await backlogs.run(org.id, null, kind.data, limit);
    console.log(
      `\nStarted ${NAMES[kind.data].title} (follow along at http://localhost:38152, ${started.workflowId}).`,
    );
    if (options.wait) {
      const result = RunBacklogResult.parse(await client.workflow.getHandle(started.workflowId).result());
      console.log(
        `done: ${plural(result.items, NAMES[result.kind].unit)}, ${result.succeeded} requests answered, ` +
          `${result.failed} failed, US$${result.costUsd.toFixed(2)}`,
      );
    }
  } else if (shown.some((b) => b.items > 0)) {
    console.log("\nRun one with: pnpm backlog <ocr|segment|tag> --run");
  }
} catch (error) {
  if (error instanceof DomainError) fail(error.message);
  throw error;
} finally {
  await connection.close();
  await database.pool.end();
}
