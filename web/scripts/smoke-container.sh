#!/usr/bin/env bash
# Starts the Linux image without credentials and checks that it serves the UI
# and fails closed without storage settings. No cloud or AI calls.
set -euo pipefail
IMAGE="${1:?usage: smoke-container.sh IMAGE}"
NAME="biplan-smoke-$$"
PORT="${SMOKE_PORT:-18080}"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$NAME" -p "127.0.0.1:$PORT:8080" "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  if curl --silent --fail --max-time 2 "http://127.0.0.1:$PORT/" --output /dev/null; then break; fi
  sleep 1
done
HOME_PAGE="$(curl --silent --fail --max-time 10 "http://127.0.0.1:$PORT/")"
grep -q 'Plan' <<<"$HOME_PAGE"
test "$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 "http://127.0.0.1:$PORT/api/health")" = 503
test "$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 "http://127.0.0.1:$PORT/plan")" = 200
STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 -X POST -H 'Content-Type: application/json' \
  --data '{"sessionId":"smoke-session","message":"konser"}' "http://127.0.0.1:$PORT/api/agent")"
test "$STATUS" = 503
echo "Container smoke passed: UI, /plan, fail-closed health and agent without settings."
