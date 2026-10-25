# 0010. NestJS 12 (ESM) with Standard Schema validation; OpenAPI from the shared contracts

- Status: Accepted
- Date: 2026-10-25

## Context

NestJS 12 is the current major version and is ESM-only. The common zod bridge, `nestjs-zod`, supports NestJS 10–11
only. We want one schema per shape, shared by the API, the web app and the Python AI engine.

## Decision

- **NestJS 12, ESM:** `"type": "module"`, `nodenext`, `.js` import suffixes; Vitest for tests.
- **Validation:** NestJS's built-in `StandardSchemaValidationPipe` validates request input against zod schemas
  given in `@Body({ schema })` / `@Query({ schema })`.
- **Responses** are documented with `@ApiResponse({ standardSchema })`, straight from `@vidyam/contracts`.
  `pnpm codegen` writes the OpenAPI document, and `packages/api-client` generates a typed fetch client from it.
- **Express adapter**, as Better Auth's NestJS integration requires.
- **NestJS knows decorator metadata is a runtime need,** so ESLint runs with `emitDecoratorMetadata` enabled.
  Otherwise `consistent-type-imports` would turn injected classes into type-only imports and break DI.

## Consequences

- No DTO classes duplicating the zod contracts.
- The OpenAPI export builds the app without the queue module, because Swagger reads only controllers and Bull
  Board needs a live HTTP adapter that Nest's preview mode doesn't create.
- **Auth rate limits live in `valkey-cache`** (Better Auth secondary storage), so every API replica shares one
  counter. Sessions stay in Postgres too, so evicting the cache never signs anyone out. Limits are keyed by
  the client IP from `X-Forwarded-For`. Caddy overwrites that header locally. On AWS, Step 92 must trust only
  the CloudFront/ALB hop, or a client could pick its own rate-limit bucket.
- **The API image drops Better Auth's optional peers** (Next.js, Vitest, drizzle-kit, …), which pnpm links
  because other workspace apps install them. That halves the image. If the API ever imports one of them, the
  container healthcheck or the e2e run against the containers will fail.
