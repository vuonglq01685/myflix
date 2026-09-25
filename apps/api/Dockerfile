FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
# Prisma picks its query-engine binary target from the libssl it detects at
# `generate` time, not just at runtime -- bookworm-slim omits the `openssl`
# package, so without this `generate` silently targets openssl-1.1.x while
# the runtime actually has openssl-3.0.x, and the engine fails to load. It
# also stops two non-JSON "failed to detect libssl" lines at every start (AC18).
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json     ./packages/db/
COPY packages/storage/package.json ./packages/storage/
COPY apps/api/package.json        ./apps/api/
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY . .
RUN pnpm --filter @myflix/db generate \
 && pnpm --filter @myflix/shared build \
 && pnpm --filter @myflix/storage build \
 && pnpm --filter @myflix/db build \
 && pnpm --filter @myflix/api build

FROM build AS runtime
ENV NODE_ENV=production
EXPOSE 4000
# Migrations run before the port opens (doc 04 §5) so no request ever hits a
# schema the code does not expect. apps/api/scripts/start.js runs the
# migration, keeps its human-readable output out of the logs on success, and
# starts the app -- see that file for why (AC18).
CMD ["node", "apps/api/scripts/start.js"]
