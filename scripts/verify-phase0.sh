#!/usr/bin/env bash
# Phase 0 Definition of Done (roadmap §3). Run after `docker compose up -d`.
# Exits non-zero on the first failure; DoD-0-2 is the project-blocking one.
set -uo pipefail

pass=0; fail=0
check() {
  local label="$1"; shift
  if "$@" >/tmp/phase0.out 2>&1; then
    printf '  PASS  %s\n' "$label"; pass=$((pass+1))
  else
    printf '  FAIL  %s\n' "$label"; sed 's/^/        /' /tmp/phase0.out | tail -5
    fail=$((fail+1))
  fi
}

echo "DoD-0-1  all services healthy"
check "compose services running" docker compose ps --status running --quiet
check "api    /health"  docker compose exec -T api node -e "fetch('http://localhost:4000/api/health').then(r=>{if(!r.ok)process.exit(1)})"
check "nginx  /nginx-health" curl -fsS -o /dev/null http://localhost/nginx-health

echo "DoD-0-2  NVENC present in the transcoder container  [BLOCKING]"
check "h264_nvenc" bash -c "docker compose exec -T transcoder ffmpeg -hide_banner -encoders 2>/dev/null | grep -q h264_nvenc"
check "hevc_nvenc" bash -c "docker compose exec -T transcoder ffmpeg -hide_banner -encoders 2>/dev/null | grep -q hevc_nvenc"
check "av1_nvenc"  bash -c "docker compose exec -T transcoder ffmpeg -hide_banner -encoders 2>/dev/null | grep -q av1_nvenc"

echo "DoD-0-3  encode a 30s clip with h264_nvenc"
check "nvenc smoke encode" docker compose exec -T transcoder sh -c \
  "ffmpeg -y -hide_banner -loglevel error -f lavfi -i testsrc2=size=1280x720:rate=30 -t 30 \
     -c:v h264_nvenc -preset p5 -b:v 3000k -f mp4 /scratch/phase0.mp4 && \
   ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 /scratch/phase0.mp4 | grep -q h264"

echo "DoD-0-4  four MinIO buckets exist"
check "buckets" bash -c "docker compose run --rm -T minio-init 2>/dev/null | grep -q myflix-media"

echo "DoD-0-5  migrations applied"
check "prisma migrate status" docker compose exec -T api npx prisma migrate status --schema packages/db/prisma/schema.prisma

echo
printf 'passed %d, failed %d\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
