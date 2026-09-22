# myflix-svc

> Responsibility text is human-owned. L3 code evidence regenerated at 7ffaae7.

## svc.api api

```yaml
name: api
image: 'build: apps/api/Dockerfile (FROM build)'
ports:
- '4000'
depends_on:
- minio
- postgres
- redis
env_keys:
- ADMIN_EMAIL
- ADMIN_PASSWORD
- ALLOW_REGISTRATION
- BUCKET_IMAGES
- BUCKET_MEDIA
- BUCKET_SOURCE
- BUCKET_STAGING
- DATABASE_URL
- JWT_ACCESS_SECRET
- JWT_ACCESS_TTL
- JWT_REFRESH_SECRET
- JWT_REFRESH_TTL
- MEDIA_SIGNING_SECRET
- MEDIA_URL_TTL_SEC
- NODE_ENV
- PORT
- PUBLIC_ORIGIN
- REDIS_HOST
- REDIS_PORT
- REDIS_URL
- S3_ACCESS_KEY
- S3_ENDPOINT
- S3_FORCE_PATH_STYLE
- S3_REGION
- S3_SECRET_KEY
- TZ
- UPLOAD_PART_SIZE_BYTES
- UPLOAD_URL_TTL_SEC
command: sh -c pnpm --filter @myflix/db migrate && node apps/api/dist/main.js
```

```
source: docker-compose.yml, apps/api/Dockerfile
```

```text
files (name-match heuristic; absence proves nothing):
  - apps/api/Dockerfile
  - apps/api/nest-cli.json
  - apps/api/package.json
  - apps/api/src/admin/admin.module.ts
  - apps/api/src/admin/controllers/admin-content.controller.ts
  - apps/api/src/admin/controllers/admin-ops.controller.ts
  - apps/api/src/admin/controllers/admin-subtitles.controller.ts
  - apps/api/src/admin/services/admin-content.service.ts
  - apps/api/src/admin/services/admin-ops.service.ts
  - apps/api/src/admin/services/admin-subtitles.service.ts
  - apps/api/src/app.module.ts
  - apps/api/src/auth/auth.controller.ts
  - apps/api/src/auth/auth.module.ts
  - apps/api/src/auth/auth.service.ts
  - apps/api/src/auth/dto/auth.dto.ts
  - apps/api/src/auth/refresh-token.service.ts
  - apps/api/src/auth/strategies/jwt.strategy.ts
  - apps/api/src/business-rules.spec.ts
  - apps/api/src/catalog/catalog.controller.ts
  - apps/api/src/catalog/catalog.module.ts
  - apps/api/src/catalog/catalog.service.ts
  - apps/api/src/catalog/my-list.controller.ts
  - apps/api/src/catalog/my-list.service.ts
  - apps/api/src/catalog/row-definitions.ts
  - apps/api/src/common/decorators/index.ts
  - apps/api/src/common/filters/all-exceptions.filter.ts
  - apps/api/src/common/guards/jwt-auth.guard.ts
  - apps/api/src/common/guards/profile.guard.ts
  - apps/api/src/common/guards/roles.guard.ts
  - apps/api/src/config/env.ts
  - apps/api/src/events/events.controller.ts
  - apps/api/src/events/events.module.ts
  - apps/api/src/health/health.controller.ts
  - apps/api/src/health/health.module.ts
  - apps/api/src/ingest/ingest.controller.ts
  - apps/api/src/ingest/ingest.module.ts
  - apps/api/src/ingest/ingest.service.ts
  - apps/api/src/main.ts
  - apps/api/src/maintenance/maintenance.module.ts
  - apps/api/src/maintenance/maintenance.service.ts
  - apps/api/src/maintenance/maintenance.spec.ts
  - apps/api/src/playback/media-url.service.ts
  - apps/api/src/playback/playback.controller.ts
  - apps/api/src/playback/playback.module.ts
  - apps/api/src/playback/playback.service.ts
  - apps/api/src/playback/progress.service.ts
  - apps/api/src/prisma/prisma.module.ts
  - apps/api/src/prisma/prisma.service.ts
  - apps/api/src/profiles/profiles.controller.ts
  - apps/api/src/profiles/profiles.module.ts
  - apps/api/src/profiles/profiles.service.ts
  - apps/api/src/queue/queue.module.ts
  - apps/api/src/redis/redis.module.ts
  - apps/api/src/storage/storage.module.ts
  - apps/api/src/storage/storage.service.ts
  - apps/api/test/fixtures/.gitignore
  - apps/api/test/fixtures/README.md
  - apps/api/test/health.e2e-spec.ts
  - apps/api/test/jest-e2e.json
  - apps/api/tsconfig.json
  - apps/web/src/lib/api-client.test.ts
  - apps/web/src/lib/api-client.ts
tables (name-match heuristic; absence proves nothing):
  - none
```

## svc.minio minio

```yaml
name: minio
image: minio/minio:latest
ports:
- 9000:9000
- 9001:9001
depends_on: []
env_keys: []
```

```
source: docker-compose.test.yml
```

```text
files (name-match heuristic; absence proves nothing):
  - scripts/minio-init.sh
tables (name-match heuristic; absence proves nothing):
  - none
```

## svc.minio-init minio-init

```yaml
name: minio-init
image: minio/mc:latest
ports: []
depends_on:
- minio
env_keys:
- MINIO_ROOT_PASSWORD
- MINIO_ROOT_USER
```

```
source: docker-compose.yml
```

```text
files (name-match heuristic; absence proves nothing):
  - scripts/minio-init.sh
tables (name-match heuristic; absence proves nothing):
  - none
```

## svc.nginx nginx

```yaml
name: nginx
image: nginx:1.27-alpine
ports:
- 80:80
depends_on:
- api
- minio
- web
env_keys:
- MEDIA_SIGNING_SECRET
- NGINX_ENVSUBST_FILTER
```

```
source: docker-compose.yml
```

```text
files (name-match heuristic; absence proves nothing):
  - infra/nginx/conf.d/00-limits.conf
  - infra/nginx/snippets/proxy-common.conf
  - infra/nginx/templates/myflix.conf.template
tables (name-match heuristic; absence proves nothing):
  - none
```

## svc.postgres postgres

```yaml
name: postgres
image: postgres:16-alpine
ports:
- 5432:5432
depends_on: []
env_keys: []
```

```
source: docker-compose.test.yml
```

```text
files (name-match heuristic; absence proves nothing):
  - infra/postgres/01-extensions.sql
tables (name-match heuristic; absence proves nothing):
  - none
```

## svc.redis redis

```yaml
name: redis
image: redis:7-alpine
ports:
- 6379:6379
depends_on: []
env_keys: []
```

```
source: docker-compose.test.yml
```

```text
files (name-match heuristic; absence proves nothing):
  - apps/api/src/redis/redis.module.ts
  - apps/transcoder/src/redis.module.ts
tables (name-match heuristic; absence proves nothing):
  - none
```

## svc.transcoder transcoder

```yaml
name: transcoder
image: 'build: infra/ffmpeg/cpu-fallback.Dockerfile (FROM node:22-bookworm-slim)'
ports: []
depends_on: []
env_keys:
- TRANSCODE_ENCODER
command: node apps/transcoder/dist/main.js
```

```
source: docker-compose.cpu.yml, infra/ffmpeg/cpu-fallback.Dockerfile
```

```text
files (name-match heuristic; absence proves nothing):
  - apps/transcoder/nest-cli.json
  - apps/transcoder/package.json
  - apps/transcoder/src/app.module.ts
  - apps/transcoder/src/config/env.ts
  - apps/transcoder/src/events/job-events.publisher.ts
  - apps/transcoder/src/ffmpeg/args.spec.ts
  - apps/transcoder/src/ffmpeg/args.ts
  - apps/transcoder/src/ffmpeg/ffmpeg.service.ts
  - apps/transcoder/src/ffmpeg/keyframe-verifier.ts
  - apps/transcoder/src/jobs/cleanup.processor.ts
  - apps/transcoder/src/jobs/subtitle.processor.ts
  - apps/transcoder/src/jobs/transcode.processor.ts
  - apps/transcoder/src/main.ts
  - apps/transcoder/src/prisma/prisma.module.ts
  - apps/transcoder/src/prisma/prisma.service.ts
  - apps/transcoder/src/redis.module.ts
  - apps/transcoder/src/storage/storage.module.ts
  - apps/transcoder/src/storage/storage.service.ts
  - apps/transcoder/tsconfig.json
tables (name-match heuristic; absence proves nothing):
  - none
```

## svc.web web

```yaml
name: web
image: 'build: apps/web/Dockerfile (FROM build)'
ports:
- '3000'
depends_on:
- api
env_keys:
- API_INTERNAL_URL
- BUCKET_IMAGES
- BUCKET_MEDIA
- BUCKET_SOURCE
- BUCKET_STAGING
- DATABASE_URL
- MEDIA_SIGNING_SECRET
- MEDIA_URL_TTL_SEC
- NEXT_PUBLIC_API_BASE_URL
- NODE_ENV
- REDIS_HOST
- REDIS_PORT
- REDIS_URL
- S3_ACCESS_KEY
- S3_ENDPOINT
- S3_FORCE_PATH_STYLE
- S3_REGION
- S3_SECRET_KEY
- TZ
command: pnpm --filter @myflix/web start
```

```
source: docker-compose.yml, apps/web/Dockerfile
```

```text
files (name-match heuristic; absence proves nothing):
  - apps/web/Dockerfile
  - apps/web/next-env.d.ts
  - apps/web/next.config.ts
  - apps/web/package.json
  - apps/web/postcss.config.mjs
  - apps/web/src/app/(admin)/admin/ingest/page.tsx
  - apps/web/src/app/(admin)/admin/page.tsx
  - apps/web/src/app/(admin)/admin/queue/page.tsx
  - apps/web/src/app/(admin)/admin/storage/page.tsx
  - apps/web/src/app/(admin)/admin/titles/[id]/page.tsx
  - apps/web/src/app/(admin)/admin/titles/page.tsx
  - apps/web/src/app/(admin)/admin/users/page.tsx
  - apps/web/src/app/(admin)/layout.tsx
  - apps/web/src/app/(auth)/login/page.tsx
  - apps/web/src/app/(auth)/register/page.tsx
  - apps/web/src/app/(viewer)/@modal/(.)title/[id]/page.tsx
  - apps/web/src/app/(viewer)/@modal/default.tsx
  - apps/web/src/app/(viewer)/browse/page.tsx
  - apps/web/src/app/(viewer)/genre/[slug]/page.tsx
  - apps/web/src/app/(viewer)/layout.tsx
  - apps/web/src/app/(viewer)/my-list/page.tsx
  - apps/web/src/app/(viewer)/search/page.tsx
  - apps/web/src/app/(viewer)/title/[id]/page.tsx
  - apps/web/src/app/(viewer)/watch/[assetId]/page.tsx
  - apps/web/src/app/layout.tsx
  - apps/web/src/app/page.tsx
  - apps/web/src/app/profiles/page.tsx
  - apps/web/src/components/admin/admin-shell.tsx
  - apps/web/src/components/browse/billboard.tsx
  - apps/web/src/components/browse/catalog-rows.tsx
  - apps/web/src/components/browse/title-card.tsx
  - apps/web/src/components/browse/title-detail-modal.tsx
  - apps/web/src/components/browse/title-detail.tsx
  - apps/web/src/components/layout/site-header.tsx
  - apps/web/src/components/player/player-shell.tsx
  - apps/web/src/components/player/use-hls.ts
  - apps/web/src/lib/api-client.test.ts
  - apps/web/src/lib/api-client.ts
  - apps/web/src/middleware.ts
  - apps/web/src/styles/global.css
  - apps/web/src/styles/tokens.css
  - apps/web/tsconfig.json
  - apps/web/vitest.config.ts
tables (name-match heuristic; absence proves nothing):
  - none
```
