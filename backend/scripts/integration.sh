#!/usr/bin/env bash
# Runs both integration suites against the real Worker (wrangler dev) and the local mock platforms.
# Each suite gets a FRESH local database and KV, because they exercise the rate limiters.
#   npm run test:integration
set -uo pipefail
cd "$(dirname "$0")/.."

[ -f .dev.vars ] || npm run --silent setup:secrets -- --sandbox
grep -q META_GRAPH_BASE .dev.vars || npm run --silent setup:secrets -- --sandbox

LOG_DIR="${TMPDIR:-/tmp}"
MOCK_PID=""
WRANGLER_PID=""

# npx / wrangler start the real server as a child process, so stop the whole tree (and nothing else on the machine)
kill_tree() {
  local pid=$1 child
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null || true
}
stop_worker() {
  if [ -n "$WRANGLER_PID" ]; then kill_tree "$WRANGLER_PID"; wait "$WRANGLER_PID" 2>/dev/null; WRANGLER_PID=""; fi
}
cleanup() { stop_worker; [ -n "$MOCK_PID" ] && kill_tree "$MOCK_PID"; }
trap cleanup EXIT

wait_for() { # url, name
  for _ in $(seq 1 90); do curl -sf -m 2 "$1" >/dev/null 2>&1 && return 0; sleep 1; done
  echo "Timed out waiting for $2 ($1)"; tail -20 "$LOG_DIR/wrangler.log" 2>/dev/null; return 1
}

node scripts/mock-platforms.mjs >"$LOG_DIR/mock.log" 2>&1 &
MOCK_PID=$!
wait_for http://localhost:9100/__state "the mock platform server" || exit 1

run_suite() {
  echo; echo "=== $1 (fresh database)"
  rm -rf .wrangler
  npx wrangler d1 migrations apply ads-saas-db --local >/dev/null 2>&1 || { echo "migrations failed"; return 1; }
  npx wrangler dev --port 8787 >"$LOG_DIR/wrangler.log" 2>&1 &
  WRANGLER_PID=$!
  wait_for http://localhost:8787/health "the API" || return 1
  node "$1"
  local status=$?
  stop_worker
  return $status
}

FAILED=0
run_suite tests/security-smoke.mjs || FAILED=1
run_suite tests/phase2-e2e.mjs || FAILED=1

echo
if [ "$FAILED" -eq 0 ]; then echo "Integration suites: all passed"; else echo "Integration suites: FAILURES (see above)"; fi
exit "$FAILED"
