# 0006. Better Auth inside NestJS (Express adapter)

- Status: Accepted
- Date: 2026-10-24

## Context

We need email/password login, invites, organizations and five roles (Super-admin, Admin, Reviewer/HoD, Teacher,
Content operator). It must work identically locally and on AWS, with no per-user fees.

## Decision

- **Better Auth**, mounted in NestJS through `@thallesp/nestjs-better-auth`, the integration linked from Better
  Auth's docs.
  - Sessions live in Postgres. The organization plugin provides roles and `@OrgRoles` guards.
  - **UUID ids**, so they match every other foreign key.
- **NestJS uses the Express adapter.** Better Auth's Fastify support is beta, and the integration needs
  `bodyParser: false`.
- **Better Auth's tables are generated into the Drizzle schema** (`packages/db`), so there is one migration owner.
- **Same-origin cookies** via `/api/*` routing (Caddy locally, CloudFront on AWS).
- **Mail:** invite and reset emails go to Mailpit locally.

## Consequences

- No Cognito dependency and no per-user cost.
- Authorization is always checked in NestJS. Next.js `proxy.ts` only redirects as a convenience.
- A community integration package is a dependency; it is pinned and wrapped behind our identity module.
