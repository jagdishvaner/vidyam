# 0007. Local environment: ports 38000–38190, toolchain pins

- Status: Accepted
- Date: 2026-10-24

## Context

The project runs locally first, on a machine where other projects already use 5000, 5432, 6379, 7000,
15432, 16379, 17880–17881, 19000–19001, 19997, 24000, 25432, 29000–29001 and 55432–55433. macOS also hands out
temporary ports from 49152–65535, which a project should never claim.

## Decision

**Port block 38000–38190.** Every container is bound to `127.0.0.1` only, so nothing is reachable from the network.

| Port          | Service                               |
| ------------- | ------------------------------------- |
| 38000         | app entry (Caddy, same origin as AWS) |
| 38100         | web                                   |
| 38110         | api                                   |
| 38120         | ai                                    |
| 38130         | PostgreSQL                            |
| 38140 / 38141 | Qdrant HTTP / gRPC                    |
| 38150 / 38151 | Valkey queue / cache                  |
| 38160 / 38161 | SeaweedFS S3 / admin UI               |
| 38170         | render health                         |
| 38180 / 38181 | Mailpit SMTP / UI                     |
| 38190         | Drizzle Studio                        |

**Container images are pinned:**

- `postgres:17.11-bookworm`
- `qdrant/qdrant:v1.20.0`
- `valkey/valkey:8.1.10-alpine`
- `chrislusf/seaweedfs:4.48`
- `axllent/mailpit:v1.32.0`
- `caddy:2.11.7-alpine`

**Toolchain is pinned per repo, with no global installs:**

- **pnpm 10.34.8** via `packageManager`; Corepack fetches it for this folder only.
- **Node 24.22.1** via `devEngines.runtime`; pnpm downloads it for this repo's scripts.
  - _This deviates from the plan's Node 22._ Node 22 support ends in April 2027, right around launch.
    Node 24 is the active LTS, supported until 2028.
- **TypeScript 6.0.3.** TypeScript 7 exists, but typescript-eslint does not support it yet (`<6.1`).
- **Python 3.12** via uv.

## Consequences

- No port conflicts with other projects, and nothing exposed to the network.
- One `pnpm infra:up` brings up an environment that matches production topology (single origin, two Valkeys,
  S3 API).
- Local credentials are fixed development values (documented in `.env.example` and the compose file); production
  secrets come from AWS Secrets Manager.
