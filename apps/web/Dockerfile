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
# `output: "standalone"` traces only server code into .next/standalone; static
# assets (CSS/JS under .next/static) and public/ are not copied automatically
# and must be placed next to the standalone server.js by hand, or every
# /_next/static/* request 404s at runtime (Next's own standalone docs).
RUN pnpm --filter @myflix/shared build \
 && pnpm --filter @myflix/web build \
 && mkdir -p apps/web/.next/standalone/apps/web/.next \
 && cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static \
 && if [ -d apps/web/public ]; then cp -r apps/web/public apps/web/.next/standalone/apps/web/public; fi

FROM build AS runtime
ENV NODE_ENV=production
EXPOSE 3000
# apps/web/scripts/start.js runs the traced standalone server.js directly
# instead of through the `next start` CLI, and wraps its non-JSON startup
# banner as JSON -- see that file for why (AC18).
CMD ["node", "apps/web/scripts/start.js"]
