FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json     ./packages/db/
COPY apps/api/package.json        ./apps/api/
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY . .
RUN pnpm --filter @myflix/db generate \
 && pnpm --filter @myflix/shared build \
 && pnpm --filter @myflix/db build \
 && pnpm --filter @myflix/api build

FROM build AS runtime
ENV NODE_ENV=production
EXPOSE 4000
# Migrations run before the port opens (doc 04 §5) so no request ever hits a
# schema the code does not expect.
CMD ["sh", "-c", "pnpm --filter @myflix/db migrate && node apps/api/dist/main.js"]
