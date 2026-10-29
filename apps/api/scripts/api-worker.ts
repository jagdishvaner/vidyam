/**
 * The API's Temporal worker on its own (ADR 0017), for tests that run workflows across both languages:
 * `tsx scripts/api-worker.ts <task-queue>` prints "ready <task-queue>" once it polls, and stops on SIGTERM.
 * The API's server process runs the same worker on the `api` queue by itself.
 */
import "reflect-metadata";

import path from "node:path";

import { NestFactory } from "@nestjs/core";

import type * as AppModuleFile from "../src/app.module.js";
import type * as EnvFile from "../src/config/env.js";
import type * as WorkerFile from "../src/modules/workflows/api-worker.js";

// The compiled build, not src: tsx drops the decorator metadata Nest's dependency injection needs.
const dist = path.resolve(import.meta.dirname, "../dist");
const { AppModule } = (await import(`${dist}/app.module.js`)) as typeof AppModuleFile;
const { loadEnv } = (await import(`${dist}/config/env.js`)) as typeof EnvFile;
const { ApiWorker } = (await import(`${dist}/modules/workflows/api-worker.js`)) as typeof WorkerFile;

const queue = process.argv[2] ?? "api";
const app = await NestFactory.create(AppModule.forRoot(loadEnv()), {
  bodyParser: false,
  logger: ["error", "warn"],
});
app.enableShutdownHooks();
await app.init();
const worker = app.get(ApiWorker);
worker.start(queue);
await worker.ready();
console.log(`ready ${queue}`);
