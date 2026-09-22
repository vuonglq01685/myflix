# MyFlix

Self-hosted VOD streaming platform. Skeleton generated from the project
documentation set in `../myflix-center-kb/source` (docs 00–13).

Nothing here streams an MP4. The smoothness comes from HLS adaptive bitrate
streaming, and the processing speed comes from hardware encoding on the GPU.

## Layout

```
myflix/
├── apps/
│   ├── web/          Next.js 15 — viewer + admin, split by route group
│   ├── api/          NestJS 11 — auth, catalog, playback, ingest, admin, SSE
│   ├── transcoder/   NestJS worker — BullMQ consumer + FFmpeg/NVENC
│   └── e2e/          Playwright — the 8 cross-service scenarios from doc 13 §6
├── packages/
│   ├── shared/       enums, DTOs, error codes, ladder/GOP/signing/progress logic
│   ├── storage/      S3 client shared by api and worker
│   └── db/           Prisma schema + the authoritative SQL migration
├── infra/
│   ├── nginx/        reverse proxy, secure_link media origin, cache
│   ├── ffmpeg/       FFmpeg built with --enable-nvenc, plus a CPU fallback
│   ├── compose/      the cpu and test compose overrides
│   └── postgres/     extension bootstrap (citext, pg_trgm, pgcrypto)
├── scripts/          minio bucket init, Phase 0 DoD checks
└── docker-compose.yml
```

## Bring-up

```bash
cp .env.example .env     # then replace every change-me-* value
make up                  # needs an NVIDIA GPU + NVIDIA Container Toolkit
make verify              # Phase 0 Definition of Done
```

No NVIDIA GPU on this machine (a Mac, or CI):

```bash
make up-cpu              # libx264 fallback — NFR-15/NFR-16 will not be met
```

| URL | What |
|---|---|
| http://localhost | app (everything goes through nginx) |
| http://localhost/api/health | health check, 503 if a dependency is down |
| http://localhost:9001 | MinIO console |

## The three hard constraints

1. **NVENC must work inside Docker.** `make verify` checks it first, and it is
   the one failure that invalidates the plan (risk R-1). The image in
   `infra/ffmpeg/Dockerfile` exists because Docker Hub's FFmpeg builds do not
   ship NVENC. `NVIDIA_DRIVER_CAPABILITIES` must include `video` — without it
   `nvidia-smi` works fine and NVENC is still invisible.
2. **Keyframes must align across renditions.** GOP = frame rate × 4, plus
   `-keyint_min`, `-sc_threshold 0` and `-forced-idr 1`. `KeyframeVerifier`
   fails the job rather than shipping an asset that stutters on every quality
   switch (AC-010-3).
3. **`MEDIA_SIGNING_SECRET` is shared between the API and nginx.** The API
   signs `/media/...?md5=&expires=`, nginx verifies it before proxying to
   MinIO. Mismatch = every playback request 403s.

## What is implemented vs. stubbed

This is a skeleton: the wiring, the contracts and the fully-specified pure
logic are real; the request handlers are not.

**Real, with tests:**
bitrate ladder and no-upscale rules · GOP/keyframe arguments · FFmpeg ladder,
preview and sprite command builders · sprite WebVTT · `-progress` parsing ·
signed-URL signing and verification (cross-checked byte-for-byte against
`openssl md5 | base64 | tr '+/' '-_'`, which is what nginx computes) ·
episode filename parsing.

**Real, untested:** the Prisma schema and SQL migration (applied against a
real Postgres 16, constraints verified to fire, zero drift between the two) ·
nginx config (`nginx -t` clean) · compose topology · guards, error envelope,
health check, write-behind progress, storage client, Redis→SSE bridge.

**Stubbed** — every service method that throws `NotImplementedException`, and
the `TODO(phase-N)` markers, keyed to the roadmap phases in doc 12.

```bash
grep -rn "NotImplementedException\|TODO(phase" apps packages
```

## Commands

```bash
pnpm install
pnpm -r build
pnpm -r test    # unit: jest (api, transcoder), vitest (web), node:test (shared)
make test-e2e   # integration (jest + supertest vs real Postgres/Redis/MinIO) + Playwright
pnpm -r typecheck
make migrate    # prisma migrate deploy inside the api container
make seed       # admin account from ADMIN_EMAIL/ADMIN_PASSWORD + 18 genres
make clean      # DESTROYS volumes: database, media, cache
```

## Database

`packages/db/prisma/migrations/20260908000000_init/migration.sql` is the
source of truth — it carries the CHECK constraints, partial indexes, the
generated `search_vector` column and the monthly partitioning that Prisma
cannot express. `schema.prisma` mirrors it for the typed client, and the two
are verified to produce an empty diff. Use `migrate deploy`, never
`migrate dev`, on a database with data.

## Next step

Phase 0 (roadmap §3, 3 days): get `make verify` fully green. Do not start
Phase 1 until DoD-0-2 passes — if NVENC is unavailable in Docker, the
contingency is `infra/ffmpeg/cpu-fallback.Dockerfile` with a 720p/480p ladder
and reset expectations on processing time.
