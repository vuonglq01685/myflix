# Phase-0 contingency (roadmap §3): if DoD-0-2 fails and NVENC is unavailable
# in Docker, build the transcoder from this file instead. libx264 is ~20x
# slower, so NFR-15/NFR-16 will NOT be met — reduce the ladder to 720p+480p
# and reset expectations before using it.
FROM node:22-bookworm-slim

# redis-tools is here only for redis-cli, which docker-compose.yml's transcoder
# healthcheck runs to prove the queue dependency (AC14 Q2). That healthcheck is
# inherited by this image via infra/compose/docker-compose.cpu.yml, which swaps
# the Dockerfile but not the healthcheck — without redis-cli here the CPU-fallback
# transcoder can never become healthy and `up -d --wait` times out.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates redis-tools \
 && npm install -g pnpm@10 \
 && rm -rf /var/lib/apt/lists/*

ENV TRANSCODE_ENCODER=libx264

WORKDIR /app
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json     ./packages/db/
COPY packages/storage/package.json ./packages/storage/
COPY apps/transcoder/package.json ./apps/transcoder/
RUN pnpm install --frozen-lockfile=false
COPY . .
RUN pnpm --filter @myflix/db generate \
 && pnpm --filter @myflix/shared build \
 && pnpm --filter @myflix/storage build \
 && pnpm --filter @myflix/db build \
 && pnpm --filter @myflix/transcoder build

CMD ["node", "apps/transcoder/dist/main.js"]
