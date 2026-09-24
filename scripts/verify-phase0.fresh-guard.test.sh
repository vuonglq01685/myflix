#!/usr/bin/env bash
# Regression test for the --fresh wipe guard (merge-risk.md SUGGESTED,
# scripts/verify-phase0.sh:15-17): --fresh must not run `docker compose
# down -v` without MYFLIX_ALLOW_WIPE=1 set.
#
# Uses a stub `docker` on PATH that only logs its argv and exits 0, so this
# never touches a real Docker daemon or a real volume. Run directly:
#   bash scripts/verify-phase0.fresh-guard.test.sh
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

stub_log="$tmpdir/docker.log"
cat >"$tmpdir/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$DOCKER_STUB_LOG"
exit 0
STUB
chmod +x "$tmpdir/docker"

fail=0

# Runs `verify-phase0.sh --fresh` against the stub docker.
# $1: MYFLIX_ALLOW_WIPE value to set, or "" to leave it unset.
run_fresh() {
  : >"$stub_log"
  if [ -z "$1" ]; then
    env -u MYFLIX_ALLOW_WIPE PATH="$tmpdir:$PATH" DOCKER_STUB_LOG="$stub_log" \
      bash "$repo_root/scripts/verify-phase0.sh" --fresh >/dev/null 2>&1
  else
    PATH="$tmpdir:$PATH" DOCKER_STUB_LOG="$stub_log" MYFLIX_ALLOW_WIPE="$1" \
      bash "$repo_root/scripts/verify-phase0.sh" --fresh >/dev/null 2>&1
  fi
}

echo "case: MYFLIX_ALLOW_WIPE unset"
run_fresh ""
exit_code=$?
if [ "$exit_code" -eq 2 ] && ! grep -Fq "down -v" "$stub_log"; then
  echo "  PASS (exit=$exit_code, stub never received down -v)"
else
  echo "  FAIL (exit=$exit_code)"
  echo "  --- stub docker log ---"
  cat "$stub_log"
  fail=1
fi

echo "case: MYFLIX_ALLOW_WIPE=1"
run_fresh "1"
if grep -Fq "compose down -v" "$stub_log"; then
  echo "  PASS (stub received compose down -v)"
else
  echo "  FAIL (stub log missing compose down -v)"
  echo "  --- stub docker log ---"
  cat "$stub_log"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "verify-phase0 fresh-guard: PASS"
else
  echo "verify-phase0 fresh-guard: FAIL"
fi
exit "$fail"
