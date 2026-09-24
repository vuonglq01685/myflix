FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json        ./apps/web/
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY . .
RUN pnpm --filter @myflix/shared build \
 && pnpm --filter @myflix/web build

FROM build AS runtime
ENV NODE_ENV=production
EXPOSE 3000
# apps/web/scripts/start.js runs the traced standalone server.js directly
# instead of through the `next start` CLI, and wraps its non-JSON startup
# banner as JSON -- see that file for why (AC18).
CMD ["node", "apps/web/scripts/start.js"]
