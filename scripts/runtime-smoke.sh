#!/usr/bin/env bash
set -euo pipefail

log_file="${TMPDIR:-/tmp}/reyo-pack-start.log"
npm run start -- --hostname 127.0.0.1 >"$log_file" 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT

for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:3000/api/health >/tmp/reyo-pack-health.json 2>/dev/null; then
    break
  fi
  sleep 1
done

curl -fsS http://127.0.0.1:3000/api/health
curl -fsS -o /tmp/reyo-pack-manifest.json -w 'manifest %{http_code} %{content_type}\n' http://127.0.0.1:3000/manifest.webmanifest
curl -fsS -o /tmp/reyo-pack-login.html -w 'login %{http_code} %{content_type}\n' http://127.0.0.1:3000/login
curl -sS -o /tmp/reyo-pack-scan.json -w 'scan-api %{http_code} %{content_type}\n' -X POST -H 'content-type: application/json' --data '{"awb":"371317811994"}' http://127.0.0.1:3000/api/scan
cat /tmp/reyo-pack-scan.json
curl -sS -o /tmp/reyo-pack-cron.json -w 'cron %{http_code} %{content_type}\n' http://127.0.0.1:3000/api/cron/sync
cat /tmp/reyo-pack-cron.json
curl -sSI http://127.0.0.1:3000/login > /tmp/reyo-pack-headers.txt
grep -E -i 'x-content-type|referrer-policy|x-frame-options|permissions-policy' /tmp/reyo-pack-headers.txt
