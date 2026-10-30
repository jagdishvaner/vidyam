# Render worker: PDF and Word files (plan v3 step 29). Build context: repository root.
ARG NODE_IMAGE=node:24.22.1-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

# Only the render worker and the workspace packages it depends on.
FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.11.10 prune @vidyam/render --docker

FROM base AS builder
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts
COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo run build --filter=@vidyam/render
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm --filter @vidyam/render deploy --prod --legacy --ignore-scripts /out

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright OTEL_SERVICE_NAME=vidyam-render
WORKDIR /app
COPY --from=builder --chown=node:node /out .
# Chromium and the system libraries it needs; the page's fonts are embedded, so no font packages.
RUN node node_modules/playwright/cli.js install --with-deps chromium && chown -R node:node /ms-playwright
USER node
CMD ["node", "--import", "@vidyam/telemetry/register", "dist/main.js"]
