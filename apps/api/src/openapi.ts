import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";

import { API_VERSION } from "./modules/system/application/check-system-status.js";

/** OpenAPI is generated from the same zod schemas that validate requests (packages/contracts). */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("Vidyam API")
    .setDescription("Business API for the Vidyam studio. AI work is delegated to the internal AI engine.")
    .setVersion(API_VERSION)
    .addCookieAuth("better-auth.session_token")
    .build();
  return SwaggerModule.createDocument(app, config);
}

export function serveOpenApi(app: INestApplication): void {
  SwaggerModule.setup("api/docs", app, buildOpenApiDocument(app), { jsonDocumentUrl: "api/openapi.json" });
}
