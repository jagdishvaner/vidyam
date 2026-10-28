# A Next.js app (standalone output): the teachers' app (APP=web, PORT=38100) or the admin panel (APP=admin,
# PORT=38102). Build context: repository root.
ARG NODE_IMAGE=node:24.22.1-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS pruner
ARG APP
COPY . .
RUN pnpm dlx turbo@2.11.10 prune @vidyam/${APP} --docker

FROM base AS builder
ARG APP
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts
COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo run build --filter=@vidyam/${APP}

FROM ${NODE_IMAGE} AS runtime
ARG APP
ARG PORT
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=${PORT} APP=${APP}
WORKDIR /app
# server.js plus only the files Next traced as needed; static assets are served by the same server.
COPY --from=builder --chown=node:node /repo/apps/${APP}/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
USER node
EXPOSE ${PORT}
CMD ["sh", "-c", "exec node apps/${APP}/server.js"]
