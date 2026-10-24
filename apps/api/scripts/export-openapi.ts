/** `pnpm codegen`: write the OpenAPI document that packages/api-client generates its typed client from. */
import "reflect-metadata";

import { writeFileSync } from "node:fs";
import path from "node:path";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "../src/app.module.js";
import { loadEnv } from "../src/config/env.js";
import { buildOpenApiDocument } from "../src/openapi.js";

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
