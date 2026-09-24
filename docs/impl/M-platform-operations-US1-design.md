# Technical design — M-platform-operations-US1 (F-044: Docker Compose full stack)

path: architectural
status: approved

## 1. Scope framing (AC24 / Q16)

Per Q16 (ticket `## Open questions`, closed 2026-09-22, BA + Project Owner) this
is **acceptance-and-gap-patching on an existing running stack**, not a
greenfield build. "Máy sạch" (clean machine) means no image, no named volume
of the project, no `.env` — the repo itself is already at its current state.
Every AC is a check against the app that already exists; a failing check is a
gap to patch, not a feature to design from zero.

Reading `docker-compose.yml`, `infra/`, `scripts/`, `.env.example`,
`apps/api/src/main.ts` and `packages/db/prisma/schema.prisma` end to end
confirms this: all 7 long-running services plus `minio-init` are already
defined, `infra/ffmpeg/Dockerfile` already builds FFmpeg with NVENC, a CPU
fallback (`infra/compose/docker-compose.cpu.yml` +
`infra/ffmpeg/cpu-fallback.Dockerfile`) already exists, `scripts/verify-phase0.sh`
already runs 4 of 5 DoD checks, `.env.example` already lists 41 variables, and
`schema.prisma` already carries 15 tables and a working Prisma-migrate-on-boot
path (`apps/api/Dockerfile` CMD). None of this is scaffolding to build; it is
the baseline this design patches to close the 15 gaps and 2 Dev-rejected
clauses found below.

**Classification: architectural.** The change set touches port and volume
topology across all 7 services, adds healthchecks to 2 services whose absence
blocks `docker compose up --wait` for the whole stack (AC1/AC16), renames 3 of
5 named volumes with a real data-identity question for anyone with the stack
already running, and touches `docker-compose.yml` (root-owned per AC27),
`infra/ffmpeg/Dockerfile`, `scripts/verify-phase0.sh`, `.env.example`,
`README.md`, and two new `docs/decisions/*.md` files. No single file or single
service confines the blast radius, so this is not a bounded or spike-sized
change.

## 2. AC-by-AC coverage table

Every verdict below is backed by a file:line read during this design pass.
"GPU-host-only" ACs (4, 5, 8, 25) have their build-time/script-time config
verified here; the runtime assertion itself can only execute on a machine
with the RTX 4070 SUPER (A-1).

| AC   | verdict                                    | what the implementation does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | files touched                                                                                                                                           | evidence (file:line)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1  | gap                                        | Add `healthcheck:` to `web` and `transcoder` (see AC14) so `docker compose up -d --wait --wait-timeout 180` has 7 healthy targets, not 5. Open verification item: `--wait`'s interaction with the one-shot `minio-init` service (no healthcheck, `restart: "no"`, nothing `depends_on`s it) is unconfirmed against this repo's Compose version — see Risk 7, §7. **Second clause (NFR-47, T32) — round 2 finding, previously undesigned:** the whole clean-machine flow, including building the FFmpeg image, must finish under **30 minutes**. `infra/ffmpeg/Dockerfile` clones and `./configure`s FFmpeg `n6.1` from source on `nvidia/cuda:12.4.1-devel-ubuntu22.04`, then runs `make -j"$(nproc)"` (`:26-41`) — the single largest consumer of that budget. No compose/Dockerfile edit in this design can guarantee a number under 30 minutes; this clause is a gap in _verification_ (nothing measures it today), not a gap this design can close with a code change — T32 supplies the procedure (§6) and Risk 6 (§7) names the fallback if the measured build overruns the budget | `docker-compose.yml`                                                                                                                                    | `docker-compose.yml:46-56` (web, no healthcheck key), `:88-115` (transcoder, no healthcheck key); `:164-174` (`minio-init`, no healthcheck, nothing declares `service_completed_successfully` on it); `infra/ffmpeg/Dockerfile:10,26-41` (source build stage; `make -j"$(nproc)"` at `:40`); ticket `M-platform-operations-US1.md:58` (AC1's NFR-47 clause), `:304` (T32)                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| AC2  | satisfied today                            | `minio-init` already `depends_on: minio (healthy)`, one-shot entrypoint, `restart: "no"` — not part of the 7. See Risk 7 (§7): whether `docker compose up --wait` correctly treats this exited-and-untracked one-shot container is unverified. **Round 3 finding (S1):** T3's own literal check (`{{.State}}`) cannot produce the exit code it expects — see §3.6 and OPEN(BA)-4's round-3 addition, §5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | none (tag pin is AC26's job)                                                                                                                            | `docker-compose.yml:164-174`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| AC3  | gap                                        | Bind `minio:9001` and add publish for `api:4000`/`web:3000` to `127.0.0.1`; `nginx:80` already LAN-correct. AC3's second half — `postgres:5432`, `redis:6379`, `minio:9000` reachable **inside** the compose network (T4b) — needs no compose change (already `expose`-only, correctly reachable service-to-service), only the verification probe itself: T4b's literal command runs `nc -z ...` inside `api`, but `api`'s image (`node:22-bookworm-slim`, `apps/api/Dockerfile:1`) installs no `nc`/netcat package anywhere — see §6 for the Node-native probe used instead                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `docker-compose.yml`                                                                                                                                    | `docker-compose.yml:152-153` (`ports: ["9001:9001"]`, all interfaces), `:54` (web `expose: ["3000"]`, nothing published), `:75` (api `expose: ["4000"]`, nothing published); `apps/api/Dockerfile` (full file — no `apt-get install`, no `nc`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| AC4  | satisfied today (GPU-host verify)          | Dockerfile already configures `--enable-nvenc`; `ffmpeg -encoders` output only provable on GPU host                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | none                                                                                                                                                    | `infra/ffmpeg/Dockerfile:33`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| AC5  | gap (GPU-host verify)                      | `scripts/verify-phase0.sh` already runs the `testsrc2` → `h264_nvenc` smoke encode and checks exit 0 + `codec_name`, but never checks the AC's `duration` bound (29.5–30.5s) — add a second `ffprobe` read for `format=duration` and assert it (see §3.6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `scripts/verify-phase0.sh`                                                                                                                              | `scripts/verify-phase0.sh:27-31` (encode + `codec_name` check only, no duration read)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| AC6  | satisfied today                            | `FFMPEG_TAG=n6.1` (≥6.1), `--enable-cuda-nvcc`, `--enable-nvenc` all present                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | none                                                                                                                                                    | `infra/ffmpeg/Dockerfile:13,31,33`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| AC7  | gap                                        | GPL/nonfree flags already set; the required decision doc does not exist — `docs/decisions/` has no files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `docs/decisions/phase0-ffmpeg-license.md` (new)                                                                                                         | `infra/ffmpeg/Dockerfile:30,36` (flags present); `docs/decisions/` (directory absent, confirmed by `ls`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| AC8  | satisfied today (GPU-host verify)          | Exactly one `deploy.resources.reservations.devices` block, on `transcoder`; `NVIDIA_DRIVER_CAPABILITIES` includes `video`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | none                                                                                                                                                    | `docker-compose.yml:109-115` (devices block), `:102` (`compute,video,utility`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| AC9  | satisfied today                            | `minio-init.sh` creates exactly the 4 named buckets, idempotently. The DoD-0-4 verification itself is weak — `scripts/verify-phase0.sh:34` only `grep -q myflix-media`s the script's output, which would still PASS with a missing or an extra bucket — tightened in §3.6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `scripts/verify-phase0.sh`                                                                                                                              | `scripts/minio-init.sh:7-9` (bucket creation, correct); `scripts/verify-phase0.sh:34` (DoD-0-4 check, too weak to prove "no more no less")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| AC10 | gap                                        | Same script sets `mc anonymous set none` on all 4 buckets — the policy side is already correct, no code change needed there. The gap is round 2's finding: T14's own literal probe, `docker compose run --rm --entrypoint curl nginx -s -o /dev/null -w '%{http_code}' http://minio:9000/myflix-media/probe.txt`, fails to exec — `nginx:1.27-alpine` ships `wget`, not `curl` (same tool gap §3.3 already found for `nginx`'s own healthcheck, `docker-compose.yml:41`), so the container never reaches MinIO and T14 reads as "lỗi kết nối" (counted FAIL by T14's own wording) before the 403 assertion is ever exercised. Substitute probe in §6                                                                                                                                                                                                                                                                                                                                                                                                                                     | none                                                                                                                                                    | `scripts/minio-init.sh:13-15` (policy, correct); `docker-compose.yml:25` (`nginx:1.27-alpine` pin), `:41` (nginx's own healthcheck already needed `wget`, confirming no `curl` in this image)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| AC11 | satisfied today                            | `api` image CMD runs `pnpm --filter @myflix/db migrate` before `node apps/api/dist/main.js`; `POSTGRES_DB`/`POSTGRES_USER` parameterised from `.env`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | none                                                                                                                                                    | `apps/api/Dockerfile` CMD line; `docker-compose.yml:120-122`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| AC12 | gap                                        | Rename `pgdata`→`myflix-postgres-data`, `redisdata`→`myflix-redis-data`, `miniodata`→`myflix-minio-data`; `nginx-cache` and `transcode-scratch` are out of AC12's 3-volume count and are left as-is (see §3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `docker-compose.yml`                                                                                                                                    | `docker-compose.yml:176-181` (5 named volumes today, not 3); `:124,138,156` (per-service mounts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| AC13 | satisfied today                            | `redis` already runs `--appendonly yes --appendfsync everysec`; healthcheck already `redis-cli ping`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | none                                                                                                                                                    | `docker-compose.yml:136,140-144`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| AC14 | conflict (D2, OPEN(BA)-2, see §4/§5) + gap | `api`'s prescribed path is rejected (D2, OPEN(BA)-2); `web` and `transcoder` have no healthcheck at all; `nginx` uses a different tool **and** a different path than AC14's literal command, `minio` and `web` use/need a different tool — all three tracked as OPEN(BA)-4 (§5), not decided here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `docker-compose.yml`, `infra/ffmpeg/Dockerfile` (add `redis-cli`)                                                                                       | `docker-compose.yml:80-84` (api, `/api/health` via `node -e fetch`), `:41` (nginx, `wget` not `curl`, `/nginx-health` not `/`), `:157-161` (minio, `mc ready local` not `curl`), `:46-56`/`:88-115` (web/transcoder, no healthcheck; web's check also needs a Node `fetch` mirror of `api`'s, not literal `curl` — no `curl` in `node:22-bookworm-slim`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| AC15 | OPEN(BA)                                   | AC15's own intent — no literal secret VALUE checked into the tree — is met: `.env` is in `.gitignore`, every `.env.example` value is a placeholder, and a value-only probe finds nothing outside `.env.example`. **Round 3 finding (B1):** the previous evidence for this row was produced by a broken command (see evidence cell) and T21's own probe, run correctly, FAILs against this correct codebase — see OPEN(BA)-5, §5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | none (BA owns the T21 amendment)                                                                                                                        | `.gitignore:7`; value-only probe — `git grep -nE '(POSTGRES_PASSWORD\|S3_SECRET_KEY\|JWT_ACCESS_SECRET\|JWT_REFRESH_SECRET)[[:space:]]*=[[:space:]]*[^$[:space:]]' -- ':!.env.example'` → no output (confirms intent). Corrected T21-shaped probe (unescaped alternation, as T21 itself uses) — `git grep -nE '(POSTGRES_PASSWORD\|S3_SECRET_KEY\|JWT_ACCESS_SECRET\|JWT_REFRESH_SECRET)[:=]' -- ':!.env.example'` → 4 hits, none a secret value, all zod schema key declarations: `apps/api/src/config/env.ts:20,27,29`, `apps/transcoder/src/config/env.ts:12`. The design's previous evidence cell here ran the alternation with `\|` still escaped, which `grep -E` reads as a literal pipe character, not alternation — that command matches nothing by construction and its "→ no output" was a false negative, not proof of AC15 |
| AC16 | gap                                        | Same root cause as AC1 — web/transcoder healthchecks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `docker-compose.yml`                                                                                                                                    | same as AC1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| AC17 | gap                                        | Same root cause as AC3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `docker-compose.yml`                                                                                                                                    | same as AC3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| AC18 | gap                                        | `api` and `transcoder` already log via Pino; `web` has **no** Pino dependency and no logger of any kind                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `apps/web/package.json`, new `apps/web/src/lib/logger.ts` (or equivalent)                                                                               | `apps/api/src/main.ts:4,12` (`nestjs-pino`); `apps/transcoder/src/main.ts`, `apps/transcoder/src/app.module.ts` (pino present); `apps/web/package.json` (no `pino`/`nestjs-pino` dependency at all — verified by full-file read)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| AC19 | gap                                        | Script has one mode only, prints PASS/FAIL only, no `WAIVED`, no `--fresh` flag; DoD-0-1's own check (`docker compose ps --status running --quiet`) exits 0 whenever the command itself succeeds, regardless of how many services are actually running or healthy — a stack with 3 of 7 services up still reports PASS, a false-PASS on the very script AC27 makes the merge gate (see §3.6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `scripts/verify-phase0.sh`                                                                                                                              | `scripts/verify-phase0.sh:1-41` (full file — no `fresh`, no `WAIVED` string anywhere); `:18` (`docker compose ps --status running --quiet`, exit-code-only check)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| AC20 | gap                                        | `README.md` has "Bring-up" (line 31) and "Next step" (line 112), not a "Phase 0 setup" section listing the 8 dependency minimums                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `README.md`                                                                                                                                             | `README.md:31-43` (Bring-up), `:112-117` (Next step) — no "Phase 0 setup" heading exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| AC21 | gap-with-conditions                        | CPU fallback compose + Dockerfile exist, but two clauses are not implemented: (1) AC21's "thu ladder về 720p và 480p" has no code — `buildLadder` (`packages/shared/src/media/ladder.ts:41`) is driven purely by source dimensions with no env knob to cap the ladder, and `cpu-fallback.Dockerfile:3-4` only comments that a human should reduce it; (2) `apps/transcoder/src/ffmpeg/args.ts:54,57,117,122` hardcode `-hwaccel cuda`/`-hwaccel_output_format cuda`/`scale_cuda=854:480` regardless of `TRANSCODE_ENCODER`, so the app's real encode path is not CPU-capable — only the DoD-0-3 script-level smoke encode is, once §3.6's preset swap lands. Both are this ticket's own AC21 scope (not F-010's, which only measures the full-ladder NVENC throughput), and both are contingent: implemented only if the NVENC budget (Q12) is actually exhausted and the branch is triggered                                                                                                                                                                                            | `apps/transcoder/src/ffmpeg/args.ts`, `packages/shared/src/media/ladder.ts`, `docs/decisions/phase0-encoder.md` — all created/changed only if triggered | `infra/compose/docker-compose.cpu.yml:1-13`; `infra/ffmpeg/cpu-fallback.Dockerfile:1-4`; `apps/transcoder/src/ffmpeg/args.ts:54,57,117,122`; `packages/shared/src/media/ladder.ts:41-59`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| AC22 | gap                                        | Union of `env_keys` across the 8 `svc.*` records is 45 (confirmed); `.env.example` has **41**, not the 36 the context cache reports — 4 missing: `PORT`, `NVIDIA_VISIBLE_DEVICES`, `NVIDIA_DRIVER_CAPABILITIES`, `NGINX_ENVSUBST_FILTER`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `.env.example`                                                                                                                                          | `.env.example:1-59` (41 vars, re-counted directly); `docker-compose.yml:64,101,102,30` (these 4 hardcoded in compose today, not templated from `.env`) — **finding: contradicts context cache's "36 present / 9 missing", see §4**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| AC23 | gap                                        | Depends on AC19's `WAIVED` support existing first                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `scripts/verify-phase0.sh`                                                                                                                              | same as AC19                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| AC24 | OPEN(BA)                                   | 13 API modules and 3 web route groups match; `schema.prisma` has 15 models, not the 14 the AC states                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | none (BA amends the ticket)                                                                                                                             | `apps/api/src/*.module.ts` (13 feature modules, excl. `app.module.ts`); `apps/web/src/app/(admin)`,`(auth)`,`(viewer)`; `packages/db/prisma/schema.prisma:94-394` (15 `model` blocks incl. `DeletionQueue`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| AC25 | satisfied today (GPU-host verify)          | `TRANSCODE_PRESET=p5` already set; no application-code gap — this is a one-off timed measurement with its own explicit procedure, not proven by any existing script (see §6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | none                                                                                                                                                    | `docker-compose.yml:96`; `.env.example:51`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| AC26 | conflict (D1, see §4) + gap                | Root already has exactly one `docker-compose.yml` and no duplicates under `infra/compose/` — D1's clause is moot to reject, since the repo already matches D1's decision, not the ticket's literal ask; `minio`/`minio-mc` still pinned to `:latest`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `docker-compose.yml`                                                                                                                                    | `find . -maxdepth 1 -name 'docker-compose*.yml'` → only `docker-compose.yml`; `docker-compose.yml:147,165` (`:latest` ×2, confirmed by `grep -c ':latest' docker-compose.yml` → `2`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| AC27 | gap                                        | Ownership rule not yet written into README; no "Phase 0 setup" section exists to hold it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `README.md`                                                                                                                                             | same as AC20                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Tally: **8 satisfied today, 15 gap, 2 conflict (Dev-rejected clauses), 2 OPEN(BA)** = 27. (Round 3: AC15 moved from "satisfied today" to `OPEN(BA)`, B1.)

## 3. Modules, files, interfaces, data changes

### 3.1 `docker-compose.yml` — port rebinding (AC3, AC17)

Today:

```
nginx:  ports: ["80:80"]                 # already LAN-correct, no change
web:    expose: ["3000"]                 # publishes nothing
api:    expose: ["4000"]                 # publishes nothing
minio:  ports: ["9001:9001"]             # all interfaces
postgres/redis/transcoder/minio-init:    # expose-only or no ports key — already correct
```

Change: replace `web`'s and `api`'s `expose:` with
`ports: ["127.0.0.1:3000:3000"]` / `["127.0.0.1:4000:4000"]`, and change
`minio`'s `ports: ["9001:9001"]` to `["127.0.0.1:9001:9001"]`. `nginx` keeps
`ports: ["80:80"]` — Docker's default bind address `0.0.0.0` already satisfies
"bind ra địa chỉ LAN" (AC3), no edit needed there. `postgres`, `redis`,
`transcoder`, `minio-init` already publish 0 ports — no change.

**Behavior change to flag:** `minio:9001` moving from all-interfaces to
`127.0.0.1` means the MinIO console is no longer reachable from other LAN
machines — this is the intended tightening under NFR-67, not a regression,
but worth naming in the PR since a developer may have bookmarked
`http://<lan-ip>:9001`.

### 3.2 `docker-compose.yml` — volume rename (AC12)

Today 5 named volumes exist (`docker-compose.yml:176-181`):
`pgdata`, `redisdata`, `miniodata`, `nginx-cache`, `transcode-scratch`. AC12
names exactly 3 — `myflix-postgres-data`, `myflix-redis-data`,
`myflix-minio-data` — and its acceptance test (T17/T17b) only touches
Postgres and MinIO durability, never `nginx-cache` or `transcode-scratch`.

**What changes:** rename the 3 volumes both in the top-level `volumes:` block
and their per-service mount (`postgres:124`, `redis:138`, `minio:156`).
**What does not change:** `nginx-cache` (`docker-compose.yml:35`, mounted at
`/var/cache/nginx`) and `transcode-scratch` (`:104`, mounted at `/scratch`)
keep their current names. Neither holds durable business data — `nginx-cache`
is `proxy_cache_path` output that self-heals from MinIO on a cache miss
(`infra/nginx/templates/myflix.conf.template:6-11`), and `transcode-scratch`
holds in-flight FFmpeg temp files for jobs that write final output to MinIO,
not to this volume, on success. AC12's count of 3 is therefore consistent
with the repo once read this way — it undercounts the compose file's total
volume surface (5) but not the set of volumes carrying state a developer would
call "data."

**Data-identity impact on a machine that already has the stack running:**
Docker named volumes are identified purely by name. Editing the compose file
to reference `myflix-postgres-data` instead of `pgdata` does **not** migrate
data — Compose creates the new name empty on the next `up`, and the old
volume (`pgdata`, `redisdata`, `miniodata`) is orphaned but **not deleted**
(only `docker compose down -v` or `docker volume rm` removes it). A developer
who already has real rows/objects in the old volumes and applies this change
naively will see an apparently-empty database and empty buckets after
`docker compose up`, while the old data physically survives on disk under the
old names until explicitly pruned.

Mitigation to document in the PR/README bring-up note (optional, not gated by
any AC since AC12's own test methodology assumes a clean machine): before
switching over, copy each volume's contents forward with a throwaway
container run while the stack is stopped. Compose resolves a named volume as
`<project>_<name>`, not the bare key in this file — with `name: myflix`
(top of this file) and `docker compose config --format json | jq '.volumes'`
confirming the real names, that is
`docker run --rm -v myflix_pgdata:/from -v myflix_myflix-postgres-data:/to alpine cp -a /from/. /to/`,
repeated for `myflix_redisdata`→`myflix_myflix-redis-data` and
`myflix_miniodata`→`myflix_myflix-minio-data`. A bare `-v pgdata:/from` would
create a new, empty `pgdata` volume and copy nothing.
Given `README.md:66-84` states this codebase is presently a skeleton with
stubbed request handlers and no real user data yet, this is a low-probability
risk today but should still be called out rather than silently accepted.

**Bring-up order:** no Compose-level sequencing hazard — named volumes are
created idempotently at `up` time regardless of declaration order. The only
ordering that matters is operational: `down` (no `-v`) → optional volume copy
→ apply the renamed compose file → `up -d --wait`.

### 3.3 Healthchecks (AC1, AC14, AC16)

Add `healthcheck:` blocks to `web` and `transcoder` (currently absent,
`docker-compose.yml:46-56` and `:88-115`) — their absence is what blocks
`docker compose up --wait` from ever reporting all 7 services `healthy`
(`docker compose ps --format '{{.Health}}'` prints empty for a service with no
healthcheck, not `healthy`), which fails AC1's and AC16's literal check.

Per AC14's Q2 decision, target commands are `curl -f http://localhost:3000/`
for `web` and `redis-cli -h redis ping` for `transcoder`. Tool-availability
audit, redone per image (the first pass was wrong about `transcoder`):

- **`transcoder`** (`infra/ffmpeg/Dockerfile`): `curl` **is** already
  installed (`:54`, `... ca-certificates curl gnupg`, pulled in for the
  NodeSource setup script at `:55`) — no change needed there. `redis-tools`
  (for `redis-cli`) is **not** installed (confirmed: no match for
  `redis-cli|redis-tools` in the file) — needs `RUN apt-get install -y
redis-tools` added to the runtime stage.
- **`cpu-fallback`** (`infra/ffmpeg/cpu-fallback.Dockerfile`): neither `curl`
  nor `redis-tools`/`redis-cli` is installed (`:7-10` installs only `ffmpeg`,
  `ca-certificates`, `pnpm`) — same `redis-tools` addition needed if this
  image is ever built as `transcoder` (AC21's CPU branch).
- **`web`** (`apps/web/Dockerfile`): no `apt-get` of any kind runs in this
  file — `curl` is **not** installed in `node:22-bookworm-slim`. The AC14
  literal command (`curl -f http://localhost:3000/`) would never turn `web`
  healthy as written. Rather than adding a `curl` layer, mirror `api`'s own
  healthcheck (`docker-compose.yml:81`, `node -e "fetch(...)"` — `api`'s image
  is also `node:22-bookworm-slim` and has no `curl` either, which is why it
  already uses Node's built-in `fetch` instead of the AC14-literal `curl`) —
  **with one correction (round 3, S4): the check must not follow redirects.**
  `curl -f` asserts the _first_ response's status and stops there; Node's
  `fetch` follows redirects by default, which is not the same check. `/` is
  `redirect('/browse')` (`apps/web/src/app/page.tsx:4`), and
  `middleware.ts:13-17` redirects again to `/login` whenever no
  `refresh_token` cookie is present — today that two-hop chain lands on a
  static stub and passes, but only by accident of where the chain currently
  ends. `/browse` itself SSRs a catalog fetch whose backend,
  `CatalogService.getRows`, still `throw`s `NotImplementedException`
  (`apps/api/src/catalog/catalog.service.ts:24`), and no `error.tsx` or
  `loading.tsx` exists anywhere under `apps/web/src/app` to catch it — so if
  the redirect chain ever lands on `/browse` instead of `/login` (e.g. a
  session cookie present), a `fetch` that follows redirects hits a 500 and
  reports `web` permanently unhealthy, timing out `up -d --wait` for AC1,
  AC14, and AC16 all at once. The check must instead read only the _first_
  response, the way `curl -f` does: do not follow the redirect, and treat any
  status under 400 on that first response as healthy. This needs no
  Dockerfile change and no rebuild.

**Literal-compliance gap on `nginx`, `minio`, and now `web`:** AC14 specifies
`curl` for all three, but none of their images carry a confirmed working
`curl` at the exact target the AC names — `nginx:1.27-alpine` ships `wget`
(current healthcheck already uses it, `:41`), the official `minio/minio`
image ships `mc` (current healthcheck already uses `mc ready local`, `:158`,
which MinIO's own docs recommend as the canonical compose healthcheck), and
`web`'s `node:22-bookworm-slim` has neither `curl` installed nor any command
matching AC14's literal text. `nginx` additionally has a **path** deviation,
not just a tool one: AC14 asks for `curl -fsS http://localhost/ -o /dev/null`
(root path `/`), but the working check hits `/nginx-health`
(`docker-compose.yml:41`) — `/` resolves through `location /` to `proxy_pass
http://web:3000` (`infra/nginx/templates/myflix.conf.template:81-86`), which
would couple `nginx`'s own health to `web`'s runtime behavior even though
`nginx` only `depends_on: web: { condition: service_started }`
(`docker-compose.yml:38`), not `service_healthy`. This is the same shape of
tension D2 already resolved for `api` (a literal AC clause vs. an
already-correct, differently-shaped check) — three more instances of it here.
D1/D2 are the only two clauses recorded as a Dev rejection; a third
unilateral rejection is not this design's call to make either. **This design
does not decide it: see OPEN(BA)-4, §5.** Until the BA rules, this design
keeps `wget`/`nginx-health` (nginx), `mc ready local` (minio), and the
corrected, redirect-refusing Node-`fetch` check above (web) as the working
checks, and records all three tool-name/path deviations in the PR the same
way D1/D2 are recorded.

**`--wait` vs. `minio-init` (AC1, AC2, Risk 7, §7):** this design does not
wire `depends_on: minio-init: { condition: service_completed_successfully }`
on any service today, because no service functionally requires MinIO's
buckets to exist before its own boot sequence. If verifying `docker compose
up --wait` against a real host shows `--wait` failing to recognize
`minio-init`'s clean exit as satisfying the wait condition, add that
condition to `api` (the natural consumer of the 4 buckets) in the same
change.

### 3.4 Image tag pinning (AC26)

`minio/minio:latest` (`docker-compose.yml:147`) and `minio/mc:latest`
(`:165`) are the only 2 `:latest` references in the file (`grep -c ':latest'
docker-compose.yml` → `2`). Both pin to a concrete `RELEASE.*` tag — per Q14
the ticket does not name a specific tag ("bản mới nhất" is not a checkable
floor), so the concrete tag value is resolved at implementation time by
reading the version actually pulled/running, then recorded in `README.md`'s
new "Phase 0 setup" section (§3.6) — not invented here.

### 3.5 `.env.example` (AC22)

Union of `env_keys` across the 8 `svc.*` records in
`.kb/myflix-svc/services.raw.md` is 45, matching the context cache. Direct
recount of `.env.example` today gives **41** entries, not 36 — see §4 for the
discrepancy against the cache. The 4 missing keys are all currently hardcoded
directly in `docker-compose.yml` rather than templated from `.env`:
`PORT` (`:64`, `PORT: 4000`), `NVIDIA_VISIBLE_DEVICES` (`:101`, `all`),
`NVIDIA_DRIVER_CAPABILITIES` (`:102`, `compute,video,utility`),
`NGINX_ENVSUBST_FILTER` (`:30`, `MEDIA_SIGNING_SECRET`). AC22 only requires
`.env.example` to **list** the union with placeholders and for bring-up to
work after copying it — it does not require compose to source every value
from `.env`. Minimal-diff choice: append the 4 lines to `.env.example` with
values matching the current hardcoded defaults, and leave `docker-compose.yml`
hardcoding them as today (no behavior change, no new interpolation surface).

**Second finding (round 2, S3) — the same password lives in two places.**
`.env.example:8` sets `POSTGRES_PASSWORD=change-me-postgres` and `:10` embeds
that identical literal password inside `DATABASE_URL`
(`postgresql://myflix:change-me-postgres@postgres:5432/myflix?schema=public`).
`docker-compose.yml:5` passes `DATABASE_URL: ${DATABASE_URL}` straight through
to every app-tier service — it is a literal passthrough, not interpolated
from `POSTGRES_PASSWORD` at the compose layer. AC22's "chạy được sau khi chỉ
copy `.env.example` sang `.env` rồi điền credential" (T1, T22) assumes
editing one password value is enough: a developer who edits
`POSTGRES_PASSWORD` and not the password segment inside `DATABASE_URL` gets a
`postgres` container that initialises with the new password while
`api`/`transcoder` still connect with the old default — `api` never turns
healthy, `docker compose up -d --wait` times out, and AC1, AC11, and AC22 all
fail on the headline bring-up command. Minimal-diff fix: no compose or
`.env.example` structure change (the 4-key addition above is unaffected, and
AC22's verified 45-variable union stays 41+4=45); instead the README "Phase 0
setup" section (§3.7) states this explicitly as a bring-up step.

### 3.6 `scripts/verify-phase0.sh` (AC19, AC23)

Current script (41 lines) has one mode and two outcomes (PASS/FAIL) across the
same 5 DoD areas AC19 names. Add:

- `--fresh` flag: when set, run three steps in order — tear the stack down
  with `docker compose down -v`, bring it back up and wait for health with
  `docker compose up -d --wait --wait-timeout 180`, **then** run the existing
  DoD-0-1..0-5 checks, so they are proven from an empty state, not against a
  stopped one. **Round 3 finding (S2):** the previous draft of this bullet
  named only the teardown step, with no rebuild between it and the checks —
  every item would then run against a stopped stack and `--fresh` would
  always FAIL. T28 ("Xóa volume, dựng lại từ rỗng, in kết quả đủ 5 mục") names
  a rebuild step explicitly; AC19 and AC23/T30 both depend on `--fresh`
  actually reaching a healthy, freshly-built stack before asserting anything.
- A `WAIVED` outcome alongside PASS/FAIL, exposed per-item, so the CPU branch
  (AC21/AC23) can mark exactly DoD-0-2 `WAIVED` while every other item still
  reports PASS/FAIL and the script still exits 0 only when nothing is `FAIL`
  (a `WAIVED` item does not count as a failure).
- **Output shape for T27's "đúng 5 mục" (exactly 5 items) — round 2 finding:**
  today the script prints 8 `check` lines under 5 headings
  (`scripts/verify-phase0.sh:18-20, 23-25, 28, 34, 37`) plus a `passed N,
failed N` tail. T27 counts item-level verdict lines, not sub-checks, so a
  rewrite that keeps one printed line per `check` call still fails T27 as
  written. The rewrite collapses each `DoD-0-N` heading into exactly **one**
  item-level verdict line (`DoD-0-1`..`DoD-0-5`, each `PASS`/`FAIL`/`WAIVED`),
  printing the underlying per-check detail only when that item's verdict is
  `FAIL` (the same indented-dump-on-failure the script already does at `:12`,
  just rolled up to the item level) — a clean run prints exactly 5 verdict
  lines plus the tail, and a failing run still shows which sub-check broke.
- DoD-0-1 exactness: `docker compose ps --status running --quiet`
  (`scripts/verify-phase0.sh:18`) exits 0 whenever the command itself
  succeeds, not when the stack is actually up — it reports PASS with 3 of 7
  services running just as readily as with all 7 healthy. Replace/augment it
  with a per-service health read and assert exactly 7 services, all
  `healthy`, plus a separate assertion for the one-shot `minio-init`
  container (AC2). **Round 3 finding (S1):** the `minio-init` assertion must
  cover three facts — the service name, its state word, AND its exit code —
  not state alone. Docker's `{{.State}}` Go-template field renders only the
  bare state word (e.g. `exited`) and never carries an exit code; the exit
  code lives in a separate field (`{{.ExitCode}}`, or the human-readable
  `{{.Status}}`, e.g. `Exited (0) ...`). A script written to assert
  `{{.State}}` alone can never produce AC2/T3's literal "`exited (0)`"
  expectation, no matter how the rest of the script is written — that is a
  fact about this codebase's Docker CLI, not a coding mistake to fix here.
  The exact field selection is a plan-phase task; owner for the AC2/T3
  literal-expectation gap: OPEN(BA)-4's round-3 addition, §5.
- DoD-0-3 duration bound: AC5 requires `ffprobe`'s `duration` to land in
  29.5–30.5s, not just a successful `codec_name` read. Add a second `ffprobe`
  call — `ffprobe -v error -show_entries format=duration -of csv=p=0
/scratch/phase0.mp4` — and assert `29.5 <= duration <= 30.5` alongside the
  existing `codec_name` check (`scripts/verify-phase0.sh:31`).
- DoD-0-4 exact bucket count: `docker compose run --rm -T minio-init | grep -q
myflix-media` (`scripts/verify-phase0.sh:34`) passes with one bucket or with
  a fifth — it only proves `myflix-media` is present, not that the set is
  exactly the 4 AC9 names. `scripts/minio-init.sh:22-23` already emits `mc ls
local` after `buckets ready:`; parse that output and assert exactly 4 lines
  matching `myflix-source`, `myflix-media`, `myflix-images`, `myflix-staging`.
- Encoder-awareness for DoD-0-2/DoD-0-3: on the CPU branch, DoD-0-2's 3 NVENC
  `check` calls become the single `WAIVED` line; DoD-0-3's smoke encode swaps
  `-c:v h264_nvenc` for `-c:v libx264`, **and** swaps `-preset p5`
  (`scripts/verify-phase0.sh:30`) for a libx264 preset (e.g. `veryfast`) —
  `p5` is an NVENC-only preset name and `libx264` rejects it outright, so
  leaving it unchanged would make AC23's "DoD-0-3 vẫn phải PASS bằng libx264"
  fail by construction, not by hardware limitation.

### 3.7 `README.md` "Phase 0 setup" (AC20, AC27)

New section, distinct from the existing "Bring-up" (`:31-43`) and "Next step"
(`:112-117`) sections. Content: the 8 minimum dependency versions verbatim
from the ticket/context cache (NVIDIA Driver Linux 550.54.14 / Windows
551.76, NVIDIA Container Toolkit 1.14.0, Docker Engine 24.x, FFmpeg 6.1+,
Node.js 20 LTS, PostgreSQL 16, Redis 7, MinIO pinned to the `RELEASE.*` tag
resolved in §3.4), the clean-machine bring-up steps, and AC27's ownership
rule: `docker-compose.yml` is owned by the Project Owner; any change to it,
in any mission, updates `scripts/verify-phase0.sh` in the same commit and
re-runs it; a green run is a merge condition. The clean-machine bring-up
steps also state (round 2, S3): `POSTGRES_PASSWORD` and the password embedded
in `DATABASE_URL` (`.env.example:8,10`) are the same value and must be edited
together — editing only one leaves `postgres` and `api`/`transcoder`
authenticating with different passwords and the stack never turns healthy
(§3.5).

**Finding, not a gap:** `apps/api/Dockerfile`, `apps/web/Dockerfile`, and
`infra/ffmpeg/Dockerfile` all build from `node:22-bookworm-slim` /
`nvidia/cuda:...` with Node 22 installed via `pnpm@10` on `node:22`, not
`node:20-lts`. AC20 only asks for a documented _minimum_, and 22 satisfies
"≥ Node.js 20 LTS" — not a conflict, but worth one line in the PR since the
README will state a floor the containers already exceed.

### 3.8 New decision docs (AC7, AC21)

- `docs/decisions/phase0-ffmpeg-license.md` — required now (the Dockerfile
  already sets `--enable-gpl --enable-nonfree`,
  `infra/ffmpeg/Dockerfile:30,36`); records acceptance of the GPL constraint
  under the NFR-68 exception, citing the non-commercial/non-distributed
  posture (`myflix-center-kb:project-charter §1`).
- `docs/decisions/phase0-encoder.md` — created only if the NVENC budget (AC21,
  Q12) is actually exhausted and the CPU fallback is invoked; not created
  speculatively by this design.

### 3.9 `apps/web` structured logging (AC18)

`apps/web/package.json` has no `pino`/logging dependency at all (full-file
read confirms). `api` (`apps/api/src/main.ts:4,12`, `nestjs-pino`) and
`transcoder` (`apps/transcoder/src/main.ts`, `apps/transcoder/src/app.module.ts`)
already emit structured Pino JSON. `web` is a Next.js 15 app (not NestJS), so
`nestjs-pino` does not apply directly — the design calls for a plain `pino`
instance wired into Next.js's server-side logging surface (route handlers,
middleware, server components) so server-side log lines are JSON and
`jq`-parseable. Client-side console output is out of this AC's scope (AC18
talks about Docker log / stdout, which only server-side Next.js output
reaches).

**Round 3 finding (S5): a `pino` instance alone does not satisfy AC18's
"100% dòng parse được bằng jq" for `web`.** Verified current log surface:
`web`'s container CMD is `pnpm --filter @myflix/web start`
(`apps/web/Dockerfile:20`), so every line in `web`'s container log today is
that launcher script's own header plus Next.js's `next start` startup banner
(the `▲ Next.js ...` / `- Local: ...` lines) — neither is JSON, and
production `next start` logs no per-request lines on its own. Wiring `pino`
only into route handlers or server components that nothing calls under an
idle stack produces zero log lines, leaving only those two non-JSON lines
for T25 (`docker compose logs web --tail N | jq .`) to read — it fails on
the banner, exactly as the clause's own test would catch.

Meeting the clause needs two changes, not one:

1. **Emit a JSON line on every request**, not just inside route handlers —
   log from `middleware.ts`, which already runs on every route its `matcher`
   covers (`apps/web/src/middleware.ts:26-27`) and, once `web`'s own
   healthcheck (§3.3) polls `/` continuously, keeps the log stream filled
   even with no human traffic.
2. **Stop shipping the two non-JSON launcher/banner lines as part of the
   steady-state log**, since they cannot be made to parse as JSON — running
   the server directly instead of through `pnpm --filter` drops the
   launcher's own header; the one-time Next.js startup banner is then the
   only non-JSON exception, and is a one-time, three-line entry at container
   start that a tail-based check can skip past or the PR can call out as a
   documented, bounded exception rather than chase into the framework.

Both are code changes (`apps/web/src/middleware.ts` plus the new
`apps/web/src/lib/logger.ts`, and the Dockerfile `CMD`), not merely a
dependency addition — adding `pino` as a library is necessary but not
sufficient on its own to satisfy this AC.

## 4. Carry-over: Dev-rejected clauses and stale-cache findings

These two are carried verbatim from `docs/impl/M-platform-operations-US1-context.md`
and **must** appear in the PR description as KB feedback to the BA, per that
document's own instruction that Dev decisions are never dropped silently.

**D1 — AC26 "0 file trùng dưới `infra/compose/`" REJECTED.** Overrides stay
at `infra/compose/docker-compose.cpu.yml` and
`infra/compose/docker-compose.test.yml`; the repo root keeps only
`docker-compose.yml`. Confirmed unchanged during this design pass:
`find . -maxdepth 1 -name 'docker-compose*.yml'` returns only
`docker-compose.yml`, and both override files still live solely under
`infra/compose/`. The rest of AC26 (exactly one copy of each compose variant,
0 images on `:latest`) stands and is designed in §3.4. Tracked for BA
amendment as OPEN(BA)-1, §5.

**D2 — AC14 `api` healthcheck path `http://localhost:4000/health` REJECTED.**
The route that exists is `/api/health` — `apps/api/src/main.ts:14` sets
`app.setGlobalPrefix('api')`, and `apps/api/src/health/health.controller.ts:14`
declares `@Controller('health')`, which together resolve to `/api/health`, not
`/health`. Writing a second unprefixed route is out of scope for this ticket.
The rest of AC14 (all 7 services get a `healthcheck:` block; the other 6
commands follow the AC) stands and is designed in §3.3. Tracked for BA
amendment as OPEN(BA)-2, §5.

**New finding — AC22's env-var count vs. the pinned context cache.** The
context cache's DECIDED-value cross-check table states `.env.example` has 36
variables against a union of 45 (9 missing). Direct recount during this
design pass — `grep -nE '^[A-Z_0-9]+=' .env.example` and a Python parse
cross-checked against each other — both give **41**, not 36, with `git log
--oneline -- .env.example` showing no commits since the grounding revision
`2946696` the cache is pinned to. The missing set is 4 keys, not 9: `PORT`,
`NVIDIA_VISIBLE_DEVICES`, `NVIDIA_DRIVER_CAPABILITIES`,
`NGINX_ENVSUBST_FILTER` — all three of the latter are already correctly
hardcoded in `docker-compose.yml` (§3.5), just not mirrored into
`.env.example`. Per "code is ground truth," this design uses 41/4, not
36/9, and this discrepancy against the pinned cache goes in the PR
description alongside D1/D2.

## 5. OPEN(BA) items

**OPEN(BA)-1 — AC26 "0 file trùng dưới `infra/compose/`" cannot pass as
written; D1 (§4) stands.** The Dev's rejection of this clause is not reversed
or weakened here — `infra/compose/docker-compose.cpu.yml` and
`infra/compose/docker-compose.test.yml` stay where commit `e52d3d6` put them,
for the reason D1 already gives (`kb code-ingest`'s first-occurrence-wins
service extraction misattributes `transcoder`/`postgres`/`redis`/`minio` to
the CPU fallback if a root-level duplicate exists). This entry exists only to
give that already-settled rejection a named amendment owner: T34 checks `ls
infra/compose/` for zero files, which FAILs against the repo as D1 leaves it.
The BA either amends AC26's `infra/compose/` clause to match the current
layout, or overrides D1 with a directive to move the overrides back to root
and accept the `-svc` extraction bug as a separate, tracked issue. Owner: BA.

**OPEN(BA)-2 — AC14 `api` healthcheck path `http://localhost:4000/health`
cannot pass as written; D2 (§4) stands.** Same treatment: D2's rejection is
not reversed — the route that exists is `/api/health`
(`apps/api/src/main.ts:14` sets the global prefix `api`), and writing a
second, unprefixed `/health` route is out of scope per the ticket's `## Out
of scope`. T20 checks `healthcheck.test` against AC14's literal command per
service, which FAILs for `api` as D2 leaves it. The BA either amends AC14's
`api` command to `curl -f http://localhost:4000/api/health` (or accepts the
existing `node -e fetch(...)` check as equivalent — see OPEN(BA)-4 for the
same tool-name question on the other services), or directs the Dev to add the
unprefixed route despite the ticket's stated scope. Owner: BA.

**OPEN(BA)-3 — AC24 states 14 tables; `schema.prisma` has 15.** Carried
verbatim from the context cache. `packages/db/prisma/schema.prisma:94-394`
defines 15 `model` blocks: `User`, `Profile`, `Title`, `Season`, `Episode`,
`Genre`, `TitleGenre`, `MediaAsset`, `Rendition`, `SubtitleTrack`,
`WatchProgress`, `MyListItem`, `TranscodeJob`, `PlaybackEvent`, and
`DeletionQueue` (`:382-394`, confirmed present, not documentation-only). The
code-knowledge document the SA grounded on already carried 15 `## db.*`
sections at the same revision — the count is wrong in the AC text, not in the
repo.

**Round 2 correction:** AC24's model count (15) and what T15's `\dt` actually
prints after migration are two different numbers, and round 1 conflated
them by proposing "15 tables including `_prisma_migrations`" — that still
doesn't add up (15 model-derived tables plus `_prisma_migrations` is 16, not 15) and, worse, undercounts the real repo state.
`packages/db/prisma/migrations/20260908000000_init/migration.sql` issues
**18** `CREATE TABLE` statements, not 15: 15 one-per-model tables (one per
`model` block above, `:20-284`) plus 3 extra physical partitions of the
`PlaybackEvent` model's `playback_events` table —
`playback_events_2026_09`, `playback_events_2026_10`,
`playback_events_default` (`:277-281`) — because Postgres partitioning
creates real child relations, and `psql \dt` lists each partition child
alongside its partitioned parent as its own row. Add Prisma's own
`_prisma_migrations` bookkeeping table (created by `prisma migrate deploy`
itself, not by this migration file) and T15's expected `\dt` output is **19
rows**: the 14 non-partitioned business tables, the partitioned
`playback_events` parent, its 3 partition children, and
`_prisma_migrations`. The BA amendment this design asks for is therefore two
separate, precise numbers: AC24's model count corrects to **15**, and T15's
expected `\dt` row count corrects to **19** (not 14, not 15). No design
decision substitutes for the BA amending the ticket text itself.

**OPEN(BA)-4 — AC14's literal `curl` command fails on `nginx`, `minio`, and
`web` (and, via the same `nginx` image, AC10's T14 probe); `nginx` also has a
path deviation.** Detailed in §3.3. AC14 specifies
`curl` for all seven services; three of them cannot run the literal command
as written: `nginx:1.27-alpine` ships `wget` not `curl` (working check
already uses `wget` at `docker-compose.yml:41`, and additionally targets
`/nginx-health` rather than AC14's `/`, because `/` proxies to `web` via
`location /` — `infra/nginx/templates/myflix.conf.template:81-86` — coupling
`nginx`'s health to a service it only `depends_on: { condition:
service_started }`, not `service_healthy`); the official `minio/minio` image
ships `mc`, which MinIO's own docs recommend for exactly this purpose
(working check already uses `mc ready local`, `:158`); and `web`'s
`node:22-bookworm-slim` base has no `curl` installed at all (no `apt-get` runs
in `apps/web/Dockerfile`). This is the same shape of tension D1/D2 already
resolved for `infra/compose/` and `api` — a literal AC clause vs. an
already-correct or already-necessary alternative — but D1/D2 are the only two
clauses this design carries as a Dev rejection; a third and fourth are not
this design's call to make unilaterally. The BA either amends AC14's `nginx`,
`minio`, and `web` commands to match the working checks (`wget
.../nginx-health`, `mc ready local`, and a Node `fetch` check mirroring
`api`'s own), or directs the Dev to add a custom `curl` image layer to all
three (and, for `nginx`, to also tighten `web`'s dependency to
`service_healthy` if the literal `/` path is kept). Owner: BA (or Dev at
execute time if the BA declines to rule and asks for the pragmatic default).

**Round 2 addition:** the same `curl`-absent-on-`nginx:1.27-alpine` gap also
breaks AC10's T14 probe, which entrypoints `curl` on the `nginx` image to hit
MinIO directly (§2 AC10 row; §6 records the working fact). It is recorded
here rather than as a fifth OPEN(BA) item because it is the identical root
cause as the `nginx` row above, not a new question for the BA to weigh.

**Round 3 addition:** AC2/T3's literal `docker compose ps -a` expectation of
an `exited (0)` state cannot be produced by a check written against Docker's
`{{.State}}` field alone — `{{.State}}` renders only the bare state word
(`exited`), never an exit code; the exit code lives in a separate field
(`{{.ExitCode}}`, or the human-readable `{{.Status}}`). See §3.6 (S1). It is
recorded here rather than as a sixth OPEN(BA) item because, like the AC10/T14
addition above, it shares OPEN(BA)-4's shape — a literal AC/T-number
expectation a correctly-written check still can't reproduce verbatim — even
though the mechanism differs (a Go-template field split across two names, not
a missing binary). The BA either accepts a check that asserts state and exit
code as two separate fields as satisfying T3's intent, or directs the Dev to
find a single literal string matching T3's exact wording.

**OPEN(BA)-5 — AC15's T21 probe over-matches TypeScript key declarations; not
decided here.** AC15's own intent is met: no literal secret VALUE is checked
into the tree (`.env` is gitignored; §2's AC15 row), and a value-only probe
returns 0 hits outside `.env.example`. But T21's own probe uses a `[:=]`
character class after the 4 secret names, which matches TypeScript object-key
syntax (`S3_SECRET_KEY: z.string().min(1),`) just as readily as an
assignment — run correctly (unescaped alternation, matching how T21 itself is
written), it returns 4 hits, all zod schema field declarations and none a
secret value: `apps/api/src/config/env.ts:20,27,29`,
`apps/transcoder/src/config/env.ts:12`. T21 expects "Không kết quả" (no
results), so it FAILs against this correct codebase. This is the same shape
of tension as OPEN(BA)-2/OPEN(BA)-4 (a literal AC/test text vs. an
already-correct codebase state), tracked as its own item because the root
cause here is a regex over-match, not a missing tool or template field. The
BA either narrows T21's probe to match only assigned values (e.g. requiring
`=` followed by a quote or `$`, not a bare `[:=]`), excludes the two
`config/env.ts` files from T21's scope, or accepts the 4 hits as a permanent,
documented exception and directs the Dev to record it rather than change the
test. Owner: BA.

No further AC was found undecidable by this design pass beyond OPEN(BA)-1
through OPEN(BA)-5 above — every other gap has a concrete file-level fix
(§3).

## 6. Verification mapping

**Round 3 change of shape (Dev directive, not a review finding):** every
blocker in three review rounds was found in the mechanics of a literal shell
command this section prescribed — a redirect not disabled, a Go-template
field that doesn't carry what it was asserted to, a `\|` escaped out of an
alternation, a missing `up` between `down -v` and the checks — never in the
design's architecture. A reviewer reading a command for that class of defect
is a weak check, and several of these ACs (AC4, AC5, AC8, AC25) can only be
executed at all on a GPU host nobody has at design time. This section
therefore states, per AC: the T-number(s) that prove it, the fact that must
be established for it to pass, the pass threshold verbatim from the ticket
with its citation, and where the check runs. It does not prescribe the
literal command — that is written and executed as a task in the plan phase,
where a broken command fails visibly the first time it runs instead of
waiting for a fourth round of reading. Values the ticket or the app's own
config already fix — an exact flag, an encoder or preset name — are kept
inline below, since those are contracts, not procedure.

| AC(s)        | T-number(s)          | Fact to establish                                                                                                                                                                                                                                                                                                                                           | Pass threshold (cited)                                                                                                                                                                                                      | Runs                                                                                                                                        |
| ------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1, AC16    | T1, T23              | All 7 compose services report `healthy`, not merely `running`, after bring-up                                                                                                                                                                                                                                                                               | `docker compose up -d --wait --wait-timeout 180` (AC1's own command) exits 0 with 7/7 `healthy`                                                                                                                             | Host                                                                                                                                        |
| AC1 (NFR-47) | T32                  | Total elapsed time for the whole clean-machine flow — image build (incl. the FFmpeg source build) through a healthy stack — per Q16's clean-machine definition (no image, no named volume, no `.env`)                                                                                                                                                       | Whole flow < **30 minutes** (NFR-47, ticket `M-platform-operations-US1.md:58`); the `up --wait` sub-phase alone < **180s** (`--wait-timeout 180`)                                                                           | Host (build/measure time is real on any host; GPU is only needed for AC4/5/8/25's own checks, not this clock)                               |
| AC2          | T3                   | The one-shot `minio-init` container ran and exited with code 0, as a fact distinct from the other 7 services' continuous `running` state                                                                                                                                                                                                                    | AC2's own state-vs-running distinction; T3's literal "`exited (0)`" wording needs the state word and the exit code read from two separate Docker fields, not one — see §3.6 (S1) and OPEN(BA)-4's round-3 addition, §5      | Host                                                                                                                                        |
| AC3, AC17    | T4, T4b              | Publish side: `web`, `api`, `minio`'s console are bound to `127.0.0.1` only; `nginx:80` stays LAN-reachable. In-network side (T4b): `postgres:5432`, `redis:6379`, `minio:9000` reachable from inside the network (e.g. from `api`) though published to nothing                                                                                             | AC3/AC17's own LAN-vs-internal binding wording                                                                                                                                                                              | Host (publish side); in-container on `api` (in-network side) — `api`'s image has no `nc` (§3.3), so the probe's tool is a plan-phase choice |
| AC4          | AC4's own test       | `transcoder`'s `ffmpeg -encoders` output lists `h264_nvenc`                                                                                                                                                                                                                                                                                                 | AC4's own wording; the build-time `--enable-nvenc` flag is already verified in §2 (`infra/ffmpeg/Dockerfile:33`)                                                                                                            | GPU host only                                                                                                                               |
| AC5          | T6                   | A 30s `testsrc2` source encodes via `h264_nvenc` to a file with `codec_name=h264` and `duration` inside the AC's bound                                                                                                                                                                                                                                      | `duration` in **29.5–30.5s** (AC5's own bound) alongside a successful `codec_name` read                                                                                                                                     | GPU host only (CPU-fallback branch: same fact against `libx264` — see the CPU-fallback note below)                                          |
| AC6, AC7     | AC6/AC7's own tests  | `ffmpeg -version`'s reported configuration includes `--enable-cuda-nvcc`/`--enable-nvenc` (AC6) and `--enable-gpl`/`--enable-nonfree` (AC7, paired with the license decision doc, §3.8)                                                                                                                                                                     | All 4 flags present in the built binary's own `-version` output; build-time flags already verified at `infra/ffmpeg/Dockerfile:13,31,33,30,36`                                                                              | No (build-time; the binary's runtime behavior is only meaningful on GPU host for AC4/5/8/25)                                                |
| AC8          | AC8's own test       | Exactly one `deploy.resources.reservations.devices` block exists and it is on `transcoder`; `NVIDIA_DRIVER_CAPABILITIES` includes `video`; the GPU is visible only inside that one container                                                                                                                                                                | AC8's own single-service-reservation wording; device count and capability string already verified at compose-config level in §2 (`docker-compose.yml:109-115`, `:102`)                                                      | GPU host only (device visibility itself; the config-level facts are host-agnostic)                                                          |
| AC9, AC10    | AC9's own test, T14  | AC9: exactly the 4 named buckets exist (`myflix-source`, `myflix-media`, `myflix-images`, `myflix-staging`) — no more, no fewer. AC10/T14: an anonymous GET against an object in `myflix-media` is denied (a connection failure counts as FAIL, not PASS, per T14's own wording)                                                                            | AC9's own 4-bucket enumeration; T14's own denial expectation                                                                                                                                                                | In-container, any host — `nginx`'s image has no `curl` (§3.3, OPEN(BA)-4), so the probe's tool and path are a plan-phase choice             |
| AC11         | AC11's own test      | After `down -v && up -d --wait`, migrations reapply automatically before the API starts listening, with no manual step; the resulting DB name/user match `.env`'s `POSTGRES_DB`/`POSTGRES_USER`                                                                                                                                                             | AC11's own automatic-migration wording; already verified at the Dockerfile-CMD level in §2 (`apps/api/Dockerfile` CMD, `docker-compose.yml:120-122`)                                                                        | Host trigger, in-container migration                                                                                                        |
| AC12         | T17, T17b            | A Postgres probe row and a MinIO staging file both survive a `down` (no `-v`) → `up -d --wait` cycle; exactly the 3 AC12-named volumes exist under their renamed names                                                                                                                                                                                      | T17/T17b's own data-survives-restart wording; `nginx-cache`/`transcode-scratch` are excluded from the 3-volume count (§3.2)                                                                                                 | Host trigger, data persists in-container                                                                                                    |
| AC13         | AC13's own test      | `redis`'s `appendonly`/`appendfsync` config (already `yes`/`everysec`, §2) actually persists a value written before a `redis` restart                                                                                                                                                                                                                       | AC13's own AOF-persistence wording; config already verified at `docker-compose.yml:136,140-144`                                                                                                                             | In-container                                                                                                                                |
| AC14         | T20                  | Each service's compose-config `healthcheck.test` is a check that is actually correct for that service's image — not necessarily AC14's literal per-service command; stopping `redis` causes `redis` and its dependent `transcoder` to leave `healthy`                                                                                                       | T20's own per-service comparison; AC14's dependent-degrades wording for the stop-`redis` case. Three of seven services have a tool/path deviation from AC14's literal text — not decided by this design, see OPEN(BA)-4, §5 | Host (`compose config` read); host trigger for the stop-and-observe case                                                                    |
| AC15         | T21                  | No literal secret VALUE (as opposed to a variable/key name) exists anywhere in the tree outside `.env.example`                                                                                                                                                                                                                                              | T21's own "Không kết quả" (no results) wording — not reachable as T21 is literally written, because its `[:=]` class also matches TypeScript key declarations; not decided by this design, see OPEN(BA)-5, §5               | Host (`git grep`, no container needed)                                                                                                      |
| AC18         | T25                  | 100% of `api`, `web`, and `transcoder`'s container log lines parse as JSON via `jq`; the other 4 services carry no AC18 requirement                                                                                                                                                                                                                         | T25's own "100% dòng parse được bằng jq" wording; for `web` specifically this requires both changes in §3.9 (S5)                                                                                                            | In-container (log source), host (`jq` read)                                                                                                 |
| AC19, AC23   | T27, T28, T30        | `scripts/verify-phase0.sh` prints exactly 5 item-level verdict lines (`DoD-0-1`..`DoD-0-5`, each `PASS`/`FAIL`/`WAIVED`) in default mode and under `--fresh`, which must reach a rebuilt, healthy stack before asserting anything (§3.6, S2); on the CPU branch exactly `DoD-0-2` is `WAIVED` while `DoD-0-3` still PASSes against `libx264`                | T27's "đúng 5 mục" wording; T28's "Xóa volume, dựng lại từ rỗng, in kết quả đủ 5 mục" wording; T30/AC23's "DoD-0-3 vẫn phải PASS bằng libx264" wording                                                                      | Host invokes the script; the script's own checks run in-container                                                                           |
| AC20, AC27   | AC20/AC27's own test | `README.md` has a "Phase 0 setup" section, distinct from "Bring-up" and "Next step", listing the 8 dependency minimums verbatim and AC27's `docker-compose.yml` ownership rule                                                                                                                                                                              | AC20/AC27's own content requirements, itemized in §3.7                                                                                                                                                                      | No (a document read)                                                                                                                        |
| AC21         | AC21's own test      | If the NVENC budget (Q12) is exhausted and the CPU branch is invoked, `docs/decisions/phase0-encoder.md` exists and records that decision; the ladder-capping and `-hwaccel`-removal code (§2 AC21 row) is present on that branch                                                                                                                           | AC21's own conditional wording — not evaluated unless the branch is triggered                                                                                                                                               | N/A (process AC; the branch's own encode fact is under AC5/AC25's CPU-fallback note below)                                                  |
| AC22         | T1, T22              | Copying `.env.example` to `.env` and filling credentials — **including `POSTGRES_PASSWORD` and the password embedded in `DATABASE_URL` together** (§3.5, round 2) — is sufficient for `up -d --wait` to reach all-healthy with no other edits; `.env.example`'s variable count matches the union of `svc.*` `env_keys`                                      | T22's own copy-and-fill wording; union is 45 (41 today + the 4 this design adds, §3.5)                                                                                                                                      | Host                                                                                                                                        |
| AC24         | T15                  | This design's own counts — 13 API feature modules, 3 web route groups, 15 Prisma models, 18 physical `CREATE TABLE` statements, 19 `\dt` rows including `_prisma_migrations` — not the ticket's                                                                                                                                                             | Not decided by this design — OPEN(BA)-3, §5, asks the BA to correct AC24's model count and T15's expected `\dt` row count to these two numbers                                                                              | No                                                                                                                                          |
| AC25         | T33                  | Encoding AC5/T6's own 30s clip to a single 1080p `h264_nvenc` rendition completes within threshold — what exactly is timed (e.g. isolating the encode step from source generation) is a plan-phase task; two review rounds (B1, round 2; S3, round 3) found defects only in a previous draft's literal timing command, which this section no longer carries | AC25's ≥8× realtime requirement (30s source ÷ 8 = **3.75s** ceiling; ADR-005's 8–12× NVENC range)                                                                                                                           | GPU host only (CPU-fallback branch: same fact against `libx264`, threshold explicitly not expected to hold — see below)                     |
| AC26         | T34                  | `minio`/`minio-mc`'s `:latest` tags are pinned to a concrete `RELEASE.*` value (§3.4); `infra/compose/` holds exactly the 2 override files D1 already accounts for, not zero                                                                                                                                                                                | `grep -c ':latest' docker-compose.yml` → `0` (currently `2`, §3.4); T34's "0 file trùng dưới infra/compose/" wording — not decided by this design, see OPEN(BA)-1, §5                                                       | Host                                                                                                                                        |

**CPU-fallback branch effect on the GPU-host-only ACs (AC4, AC5, AC8, AC25):**
if the NVENC budget in AC21 is exhausted and the CPU fallback is invoked,
AC4's and AC8's facts are no longer meaningful (no GPU reservation, no NVENC
encoders to list) — AC19's script reports `DoD-0-2` as `WAIVED`, not run, per
AC23. AC5's and AC25's facts still apply, but against `libx264` instead of
`h264_nvenc`: AC23 requires DoD-0-3 to still PASS (CPU can encode 30s without
a GPU), while AC25's ≥8× realtime threshold is explicitly not expected to
hold on `libx264` (ADR-005 cites 0.4–0.6× realtime for CPU vs 8–12× for
NVENC) — the ticket records this as "NFR-15 không đạt" (AC21) rather than an
AC25 failure to chase, since AC25's threshold is NVENC-only by design intent.

## 7. Risks and bring-up/rollback order

**Risks:**

1. **Volume rename data loss** (§3.2) — silent for anyone with real data in
   `pgdata`/`redisdata`/`miniodata` today; low-probability given the
   skeleton's stubbed handlers, but not zero, and not caught by any AC's test
   procedure (which assumes a clean machine).
2. **MinIO console reachability regression** (§3.1) — `9001` moving to
   `127.0.0.1` breaks remote-LAN access to the console; intentional per
   NFR-67, but a behavior change worth flagging.
3. **New healthchecks exposing latent startup-order issues** — `web` and
   `transcoder` have never been gated by a healthcheck before; adding one may
   reveal that `web`'s default `start_period`/`retries` are too tight for a
   cold `next start`, or that `transcoder`'s Redis-ping check races the
   worker's own boot sequence. Tune `start_period` empirically during
   execute, not guessed here.
4. **Tool-choice gap on nginx/minio/web healthchecks** (§3.3, OPEN(BA)-4) — a
   real engineering decision (add `curl` via custom image layers vs. keep
   `wget`/`mc`/Node `fetch`) is tracked as OPEN(BA)-4 for the BA to rule on;
   picking wrong either adds unnecessary image-build surface or leaves a
   literal-AC-text mismatch unresolved.
5. **`scripts/verify-phase0.sh` is the merge gate** (AC27) — any slip in the
   `--fresh`/`WAIVED` rewrite that makes the script report false PASS defeats
   the entire Phase 0 acceptance purpose; this script's own change needs the
   same scrutiny as the compose file it verifies.
6. **Source FFmpeg build may not fit NFR-47's 30-minute budget** (AC1, T32) —
   `infra/ffmpeg/Dockerfile:26-41` clones and compiles FFmpeg `n6.1` from
   source with `make -j"$(nproc)"` on `nvidia/cuda:12.4.1-devel-ubuntu22.04`;
   this is the single largest consumer of AC1's 30-minute clean-machine
   budget and nothing in this design shrinks it — the real number is only
   known by running T32's procedure (§6) on a real host. If the measured
   total exceeds 30 minutes, the fallback (not implemented speculatively
   here, per YAGNI — Phase 0 measures once, it does not need a caching layer
   built in advance of evidence it's needed) is a prebuilt/pinned FFmpeg base
   image or a BuildKit layer cache mounted across builds, decided after the
   real number is in hand.
7. **`--wait` vs. the one-shot `minio-init` container** (AC1, AC2) —
   `docker compose up -d --wait --wait-timeout 180` waits for services to be
   running or healthy; `minio-init` has neither an ongoing "running" state
   (it exits 0 by design) nor a healthcheck, and no other service declares
   `depends_on: minio-init: { condition: service_completed_successfully }`
   (Docker Compose's own docs recommend exactly that condition for this
   one-shot pattern). Whether `--wait` already tolerates an exited, untracked
   one-shot service or times out waiting for it is unconfirmed on this repo's
   Compose version — verify on a real host during execute. If it trips, wire
   `service_completed_successfully` (e.g. on `api`, the natural consumer of
   MinIO's buckets) and record the change in §3.3.

**Bring-up order for a developer who already has the current stack running:**

1. `docker compose down` (no `-v`) — stop containers, keep all 5 existing
   volumes intact.
2. If real data exists in `pgdata`/`redisdata`/`miniodata`: run the
   volume-copy commands from §3.2 for each of the 3 renamed volumes now,
   while nothing is running and nothing is writing.
3. Apply the `docker-compose.yml`, `.env.example`, `scripts/verify-phase0.sh`,
   `infra/ffmpeg/Dockerfile`, `README.md` changes from §3.
4. `docker compose build` (nginx/minio only need rebuilding if the §3.3
   custom-curl-layer path is chosen; otherwise only `transcoder`'s new
   `redis-tools` install needs a rebuild).
5. `docker compose up -d --wait --wait-timeout 180`.
6. `scripts/verify-phase0.sh` (default mode) against the live stack, then
   `scripts/verify-phase0.sh --fresh` from empty, per AC19.

**Rollback:** this ticket makes no schema or migration change (AC12
explicitly keeps business tables untouched via a throwaway `phase0_probe`
table), so rollback is a pure infra revert: `git revert` the compose/script/doc
commit(s), `docker compose down`, re-apply the previous `docker-compose.yml`
(which still resolves `pgdata`/`redisdata`/`miniodata` if step 2 above was
skipped or the copies were additive rather than destructive), `docker compose
up -d`. No data migration needs undoing since the copy step in §3.2 is
additive (old volumes are never deleted by this design).

## Review record

| Date       | Round        | Verdict                                                        | Reviewer        | Open gaps                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------ | -------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-22 | 1            | BLOCKER x3, SUGGESTED x7                                       | design-reviewer | AC5 verdict wrong (no duration bound); DoD-0-1 false-PASS in verify-phase0.sh:18; AC14 nginx/minio deviation left as recommendation instead of OPEN(BA)                                                                                                                                                                                                                                                                                                                   |
| 2026-09-22 | 2            | BLOCKER x3, SUGGESTED x4                                       | design-reviewer | AC25 timing command always reports 0.00s; AC1's NFR-47 30-minute clause and T32 absent; AC10 T14 probe uses curl, absent from nginx:1.27-alpine                                                                                                                                                                                                                                                                                                                           |
| 2026-09-22 | 3            | BLOCKER x1, SUGGESTED x5 — round cap reached, escalated to Dev | design-reviewer | AC15 verdict rests on a grep whose `\|` alternation was escaped out of the ticket's markdown (false negative; real T21 returns 4 hits in 2 zod schemas); `{{.State}}` never carries an exit code so the AC2 assertion false-FAILs; `--fresh` has no `up` between `down -v` and the checks; AC25 times source generation together with the encode; web healthcheck rides a 2-hop redirect chain to a stub; AC18 web clause never reaches the `next start` banner T25 reads |
| 2026-09-22 | 3 (post-fix) | Review: ✅ r3 (round cap, Dev-approved)                        | Dev             | B1/S1/S2/S4/S5 applied; §6 converted from literal commands to verification intent — the exact commands are written and executed as plan-phase tasks. N*/NIT* from all three rounds recorded, not fixed.                                                                                                                                                                                                                                                                   |
