#!/usr/bin/env bash
set -euo pipefail
image=${1:?image required}
work=$(mktemp -d)
name="checkers-smoke-$$"
cleanup() {
  docker rm -f "$name" "$name-redis" >/dev/null 2>&1 || true
  docker network rm "$name" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
docker network create "$name" >/dev/null
docker run -d --name "$name-redis" --network "$name" --network-alias checkers-redis   docker.dragonflydb.io/dragonflydb/dragonfly:v1.37.0 --bind=0.0.0.0 --proactor_threads=1 --maxmemory=256mb --snapshot_cron= >/dev/null
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$work/tls.key" -out "$work/tls.crt" -days 1 -subj /CN=localhost -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' >/dev/null 2>&1
chmod 755 "$work"
chmod 644 "$work/tls.key" "$work/tls.crt"
for mode in http https; do
  tls=()
  if [ "$mode" = https ]; then
    tls=(-v "$work:/tls:ro" -e TLS_CERT_FILE=/tls/tls.crt -e TLS_KEY_FILE=/tls/tls.key -e NODE_EXTRA_CA_CERTS=/tls/tls.crt)
  fi
  docker run -d --name "$name" --network "$name" --read-only --user 1001:1001 --tmpfs /tmp -e AUTH_MODE=anon "${tls[@]}" "$image" >/dev/null
  ready=false
  for attempt in $(seq 1 30); do
    if docker exec "$name" node -e "fetch('$mode://127.0.0.1:3002/ready').then(r => process.exit(r.ok ? 0 : 1))" >/dev/null 2>&1; then ready=true; break; fi
    sleep 1
  done
  if [ "$ready" != true ]; then docker logs "$name"; exit 1; fi
  docker exec -i -e SMOKE_SCHEME="$mode" "$name" node --input-type=module < scripts/smoke-runtime.mjs
  docker stop --time 30 "$name" >/dev/null
  test "$(docker inspect -f '{{.State.ExitCode}}' "$name")" = 0
  docker rm "$name" >/dev/null
  echo "$mode image smoke test passed"
done
