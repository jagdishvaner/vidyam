import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";
import { loadEnv } from "./config/env.js";
import { ApiWorker } from "./modules/workflows/api-worker.js";
import { serveOpenApi } from "./openapi.js";

const env = loadEnv();
// Better Auth needs the raw request body; the auth module re-adds parsers for every other route.
const app = await NestFactory.create(AppModule.forRoot(env), { bodyParser: false });
app.setGlobalPrefix("api");
app.enableShutdownHooks();
if (env.NODE_ENV !== "production") serveOpenApi(app);
await app.listen(env.VIDYAM_API_PORT, env.VIDYAM_API_HOST);
// Commits workflow results (ADR 0017); only the server process polls, not scripts.
app.get(ApiWorker).start();
console.log(`Vidyam API listening on http://${env.VIDYAM_API_HOST}:${env.VIDYAM_API_PORT}/api`);
