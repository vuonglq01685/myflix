#!/usr/bin/env bash
# Phase 0 Definition of Done (roadmap §3). Run after `docker compose up -d`,
# or pass --fresh to tear the stack down and bring it back up from empty first.
# Runs every check regardless of earlier failures and exits non-zero at the
# end if any failed; DoD-0-2 is the project-blocking one.
set -uo pipefail

pass=0; fail=0

FRESH=0
[ "${1:-}" = "--fresh" ] && FRESH=1
[ $# -gt 0 ] && [ "$1" != "--fresh" ] && { echo "unknown argument: $1" >&2; exit 2; }
[ $# -gt 1 ] && { echo "usage: $0 [--fresh]" >&2; exit 2; }

if [ "$FRESH" -eq 1 ]; then
  docker compose down -v
  docker compose up -d --wait --wait-timeout 180 || { echo "--fresh bring-up failed"; exit 1; }
fi

item_result="PASS"
item_detail=""
subcheck() {
  local label="$1"; shift
  if "$@" >/tmp/phase0.out 2>&1; then
    : # sub-check passed, nothing printed
  else
    item_result="FAIL"
    item_detail="$item_detail$(printf '\n  %s:\n' "$label"; sed 's/^/    /' /tmp/phase0.out | tail -5)"
  fi
}
item_done() {
  local label="$1"
  if [ "$item_result" = "WAIVED" ]; then
    printf '%s  WAIVED\n' "$label"
  elif [ "$item_result" = "FAIL" ]; then
    printf '%s  FAIL%s\n' "$label" "$item_detail"
    fail=$((fail+1))
  else
    printf '%s  PASS\n' "$label"
    pass=$((pass+1))
  fi
  item_result="PASS"; item_detail=""
}

echo "DoD-0-1  all services healthy"
subcheck "compose services running" docker compose ps --status running --quiet
subcheck "api    /health"  docker compose exec -T api node -e "fetch('http://localhost:4000/api/health').then(r=>{if(!r.ok)process.exit(1)})"
subcheck "nginx  /nginx-health" curl -fsS -o /dev/null http://localhost/nginx-health
item_done "DoD-0-1"

echo "DoD-0-2  NVENC present in the transcoder container  [BLOCKING]"
if [ "${TRANSCODE_ENCODER:-h264_nvenc}" != "h264_nvenc" ]; then
  item_result="WAIVED"
else
  subcheck "h264_nvenc" bash -c "docker compose exec -T transcoder ffmpeg -hide_banner -encoders 2>/dev/null | grep -q h264_nvenc"
  subcheck "hevc_nvenc" bash -c "docker compose exec -T transcoder ffmpeg -hide_banner -encoders 2>/dev/null | grep -q hevc_nvenc"
  subcheck "av1_nvenc"  bash -c "docker compose exec -T transcoder ffmpeg -hide_banner -encoders 2>/dev/null | grep -q av1_nvenc"
fi
item_done "DoD-0-2"

echo "DoD-0-3  encode a 30s clip with h264_nvenc"
subcheck "nvenc smoke encode" docker compose exec -T transcoder sh -c \
  "ffmpeg -y -hide_banner -loglevel error -f lavfi -i testsrc2=size=1280x720:rate=30 -t 30 \
     -c:v h264_nvenc -preset p5 -b:v 3000k -f mp4 /scratch/phase0.mp4 && \
   ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 /scratch/phase0.mp4 | grep -q h264"
item_done "DoD-0-3"

echo "DoD-0-4  four MinIO buckets exist"
subcheck "buckets" bash -c "docker compose run --rm -T minio-init 2>/dev/null | grep -q myflix-media"
item_done "DoD-0-4"

echo "DoD-0-5  migrations applied"
subcheck "prisma migrate status" docker compose exec -T api npx prisma migrate status --schema packages/db/prisma/schema.prisma
item_done "DoD-0-5"

echo
printf 'passed %d, failed %d\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
