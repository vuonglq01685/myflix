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

## Phase 0 setup

Minimum dependency versions (verified against the running host/containers at acceptance time, not just declared here):

| Dependency | Minimum |
|---|---|
| NVIDIA Driver | Linux 550.54.14 / Windows 551.76 |
| NVIDIA Container Toolkit | 1.14.0 |
| Docker Engine | 24.x |
| FFmpeg | 6.1+ (built with `--enable-nvenc --enable-cuda-nvcc`, see `infra/ffmpeg/Dockerfile`) |
| Node.js | 20 LTS |
| PostgreSQL | 16 |
| Redis | 7 |
| MinIO | `RELEASE.2025-09-07T16-13-09Z` (server) and `RELEASE.2025-08-13T08-35-41Z` (`mc`), both pinned in `docker-compose.yml`. Both images come from quay.io, not Docker Hub — MinIO removed its Docker Hub repositories |

**Clean-machine bring-up** (Q16: no image, no named volume of this project, no `.env` — the repo itself is already at its current state):
1. `cp .env.example .env`, then replace every `change-me-*` placeholder.
   **Two pairs share one literal each and must be edited to the same new value within the pair:** `POSTGRES_PASSWORD` and the password embedded in `DATABASE_URL` (`.env.example:8,10`), and `MINIO_ROOT_PASSWORD` and `S3_SECRET_KEY` (`.env.example:19,23`). `docker-compose.yml` passes `DATABASE_URL` straight through, with no interpolation from `POSTGRES_PASSWORD`, so nothing reconciles them for you. Giving the members of a pair different values breaks authentication: for the first, `postgres` and `api`/`transcoder` disagree; for the second, `minio`'s `mc ready local` healthcheck fails, so `minio-init` never creates the buckets. Either way the stack never turns healthy and `docker compose up -d --wait` times out.
2. `docker compose up -d --wait --wait-timeout 180` — builds the FFmpeg image (source build, the single largest consumer of the 30-minute budget below) then starts all 8 services — the 7 long-running ones plus the one-shot `minio-init`, which creates the buckets and exits. `make up` is the day-to-day shortcut, but it omits `--wait`, so it does not enforce the 180-second bound below.
3. `bash scripts/verify-phase0.sh` — expect PASS on all 5 items.
   **On the CPU-fallback branch, set the encoder on the script's own command line:** `TRANSCODE_ENCODER=libx264 bash scripts/verify-phase0.sh`. That WAIVES DoD-0-2 and runs DoD-0-3 on `libx264`. The `TRANSCODE_ENCODER` in `infra/compose/docker-compose.cpu.yml` is scoped to the `transcoder` container and is invisible to the script, which never reads `.env` — so on a CPU-only host without it, DoD-0-2 and DoD-0-3 both **FAIL**.
   **A WAIVED DoD-0-2 is not a pass.** It increments neither counter, so the run prints `passed 4, failed 0` and exits 0: a green exit does not prove NVENC. DoD-0-2 is the project-blocking item — do not start Phase 1 until it actually passes.

**Time budget (NFR-47):** the whole clean-machine flow, image build included, must finish under **30 minutes**; `docker compose up -d --wait` alone must finish under its own 180-second `--wait-timeout`.

**`docker-compose.yml` ownership (AC27, Q7):** this file is owned by the Project Owner. Any change to it, in any mission, updates `scripts/verify-phase0.sh` in the same commit and re-runs it; a green run is a merge condition.

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
