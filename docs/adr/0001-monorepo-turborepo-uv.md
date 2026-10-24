# 0001. Turborepo + pnpm monorepo, uv workspace for Python

- Status: Accepted
- Date: 2026-10-24

## Context

Vidyam is polyglot: a Next.js frontend and a NestJS API in TypeScript, a Python AI engine, and a Node render
worker. We want one repository, one command to build/test everything, and caching so CI only redoes work
that changed.

Turborepo 2.11 has native uv workspace support behind the `experimentalPythonWorkspaces` flag. Its docs list
three gaps that matter to us:

- no `dev` task for Python members;
- no way to declare a dependency from a Python member on a JS package. We need one: generated Pydantic
  models come from `packages/contracts`;
- no documentation of how it coexists with pnpm workspaces.

## Decision

- **pnpm workspaces** (`apps/*`, `packages/*`) and **Turborepo 2.11.10**, pinned, for task orchestration.
- **uv workspace** at the repo root (virtual root, one `uv.lock`) for Python dependencies.
- Each Python app also has a small **`package.json` whose scripts call `uv run --frozen …`**, so turbo treats it
  like any other package: `dev`, dependencies on JS packages, and caching all work. The root `uv.lock`,
  `pyproject.toml` and `.python-version` are turbo `globalDependencies`, so dependency changes bust the cache.
- The experimental flag stays **off**. We revisit when it supports dev tasks and cross-ecosystem dependencies.

## Consequences

- One mental model: every task is `pnpm turbo run <task>`, whatever the language.
- Python packages carry two manifests (`pyproject.toml` for dependencies, `package.json` for task wiring).
  Python dependencies are only ever declared in `pyproject.toml`.
- Python Docker images are built with `uv sync --frozen --package <name> --no-dev`; Node images with
  `turbo prune`.
