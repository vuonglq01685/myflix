# myflix-svc

> Responsibility text is human-owned. L3 code evidence regenerated at 7ffaae7.

## svc.api api

Service api (apps/api, NestJS): built from apps/api/Dockerfile (build stage), port 4000, depends_on minio/postgres/redis. Command runs `pnpm --filter @myflix/db migrate` then `node apps/api/dist/main.js`. Source: docker-compose.yml, apps/api/Dockerfile. env_keys span admin bootstrap (ADMIN_EMAIL, ADMIN_PASSWORD, ALLOW_REGISTRATION), buckets (BUCKET_IMAGES, BUCKET_MEDIA, BUCKET_SOURCE, BUCKET_STAGING), DATABASE_URL, JWT_ACCESS_SECRET, JWT_ACCESS_TTL, JWT_REFRESH_SECRET, JWT_REFRESH_TTL, media (MEDIA_SIGNING_SECRET, MEDIA_URL_TTL_SEC), runtime (NODE_ENV, PORT, PUBLIC_ORIGIN, TZ), Redis (REDIS_HOST, REDIS_PORT, REDIS_URL), S3_ACCESS_KEY, S3_ENDPOINT, S3_FORCE_PATH_STYLE, S3_REGION, S3_SECRET_KEY, uploads (UPLOAD_PART_SIZE_BYTES, UPLOAD_URL_TTL_SEC). File heuristic lists NestJS modules: admin, auth, catalog, events, health, ingest, maintenance, playback, profiles, queue, redis, storage, prisma, plus test fixtures and apps/web/src/lib/api-client.ts.

## svc.minio minio

minio service (minio/minio:latest), ports 9000:9000 and 9001:9001, no deps/env; from docker-compose.test.yml.

## svc.minio-init minio-init

minio-init (minio/mc:latest) depends on minio; uses MINIO_ROOT_USER/MINIO_ROOT_PASSWORD; runs scripts/minio-init.sh.

## svc.nginx nginx

nginx (nginx:1.27-alpine) on port 80:80, depends on api/minio/web; env MEDIA_SIGNING_SECRET, NGINX_ENVSUBST_FILTER; templated conf in infra/nginx.

## svc.postgres postgres

postgres (postgres:16-alpine), port 5432:5432, no deps/env; test compose; init via infra/postgres/01-extensions.sql.

## svc.redis redis

Redis 7-alpine test service on port 6379:6379, no deps/env; used via redis.module.ts in api and transcoder.

## svc.transcoder transcoder

Transcoder service (docker-compose.cpu.yml) built via infra/ffmpeg/cpu-fallback.Dockerfile (FROM node:22-bookworm-slim); no ports or depends_on; env_keys: TRANSCODE_ENCODER; command: node apps/transcoder/dist/main.js. Includes ffmpeg args/service, keyframe-verifier, transcode/subtitle/cleanup job processors, job-events publisher, redis.module.ts, prisma module/service, and storage module/service.

## svc.web web

Web service built from apps/web/Dockerfile (FROM build stage), depends on api, exposes port 3000, runs command: pnpm --filter @myflix/web start (docker-compose.yml). env_keys: API_INTERNAL_URL, BUCKET_IMAGES, BUCKET_MEDIA, BUCKET_SOURCE, BUCKET_STAGING, DATABASE_URL, MEDIA_SIGNING_SECRET, MEDIA_URL_TTL_SEC, NEXT_PUBLIC_API_BASE_URL, NODE_ENV, REDIS_HOST, REDIS_PORT, REDIS_URL, S3_ACCESS_KEY, S3_ENDPOINT, S3_FORCE_PATH_STYLE, S3_REGION, S3_SECRET_KEY, TZ. Next.js app under apps/web/src/app covers (admin) routes (ingest, queue, storage, titles, users), (auth) login/register, and (viewer) routes (browse, genre, my-list, search, title, watch) plus a parallel @modal route; includes browse/player/admin components, lib/api-client.ts, middleware.ts, and global.css/tokens.css.
