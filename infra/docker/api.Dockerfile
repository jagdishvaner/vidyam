# NestJS API. Build context: repository root.
ARG NODE_IMAGE=node:24.22.1-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

# Only the API and the workspace packages it depends on.
FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.11.10 prune @vidyam/api --docker

FROM base AS builder
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts
COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo run build --filter=@vidyam/api
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm --filter @vidyam/api deploy --prod --legacy --ignore-scripts /out
# Better Auth lists next, vitest, drizzle-kit, etc. as optional peers, and pnpm links them because other
# workspace apps install them. The API never imports any of these; dropping them saves ~450 MB.
RUN cd /out/node_modules/.pnpm && rm -rf next@* @next+swc-* @playwright+test@* playwright@* playwright-core@* \
    vitest@* @vitest+* vite@* rolldown@* @rolldown+* esbuild@* @esbuild+* lightningcss* drizzle-kit@* \
    @img+sharp-* sharp@* typescript@*

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production VIDYAM_API_HOST=0.0.0.0 VIDYAM_API_PORT=38110 OTEL_SERVICE_NAME=vidyam-api
WORKDIR /app
COPY --from=builder --chown=node:node /out .
USER node
EXPOSE 38110
CMD ["node", "--import", "@vidyam/telemetry/register", "dist/main.js"]
