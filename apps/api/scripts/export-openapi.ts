/** `pnpm codegen`: write the OpenAPI document that packages/api-client generates its typed client from. */
import "reflect-metadata";

import { writeFileSync } from "node:fs";
import path from "node:path";

import { NestFactory } from "@nestjs/core";

import type * as AppModuleFile from "../src/app.module.js";
import type * as EnvFile from "../src/config/env.js";
import type * as OpenApiFile from "../src/openapi.js";

// The compiled build, not src: tsx (esbuild) drops the decorator type metadata Swagger reads request bodies
// and path parameters from, while `nest build` (tsc) keeps it. Turbo builds the API before this runs.
const dist = path.resolve(import.meta.dirname, "../dist");
const { AppModule } = (await import(`${dist}/app.module.js`)) as typeof AppModuleFile;
const { loadEnv } = (await import(`${dist}/config/env.js`)) as typeof EnvFile;
const { buildOpenApiDocument } = (await import(`${dist}/openapi.js`)) as typeof OpenApiFile;

// Preview mode builds the module graph without instantiating providers: no database or Redis needed.
const app = await NestFactory.create(AppModule.forRoot(loadEnv(), { queues: false }), {
  preview: true,
  logger: false,
  abortOnError: false,
});
app.setGlobalPrefix("api");
const out = path.resolve(import.meta.dirname, "../../../packages/api-client/openapi.json");
writeFileSync(out, `${JSON.stringify(buildOpenApiDocument(app), null, 2)}\n`);
await app.close();
console.log(`wrote ${path.relative(process.cwd(), out)}`);
