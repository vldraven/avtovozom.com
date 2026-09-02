#!/usr/bin/env bash
# Починка HTTPS на проде: синхронизация Caddyfile и перезапуск Caddy.
set -euo pipefail

DEPLOY_PATH="${1:-/opt/avtovozom}"
CADDYFILE="/etc/caddy/Caddyfile"
REPO_CADDYFILE="${DEPLOY_PATH}/deploy/Caddyfile"
ACME_EMAIL="noreply@avtovozom.com"

run_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    "$@"
  fi
}

echo "=== identity ==="
id
whoami

if [[ ! -f "$REPO_CADDYFILE" ]]; then
  echo "Missing $REPO_CADDYFILE"
  exit 1
fi

echo "=== install Caddyfile from repo ==="
run_root mkdir -p /etc/caddy
run_root cp "$REPO_CADDYFILE" "$CADDYFILE"
run_root chmod 644 "$CADDYFILE"

if grep -q 'you@example.com' "$CADDYFILE"; then
  echo "Replacing placeholder ACME email..."
  run_root sed -i "s/you@example.com/${ACME_EMAIL}/g" "$CADDYFILE"
fi

echo "=== validate Caddyfile ==="
run_root caddy validate --config "$CADDYFILE"

if grep -q 'example.com' "$CADDYFILE"; then
  echo "Caddyfile still contains example.com — abort"
  exit 1
fi

echo "=== restart caddy ==="
run_root systemctl enable caddy 2>/dev/null || true
run_root systemctl restart caddy

echo "=== wait for certificate renewal ==="
for attempt in $(seq 1 18); do
  sleep 5
  if curl -fsS "https://api.avtovozom.com/health" >/dev/null 2>&1; then
    echo "HTTPS OK on attempt ${attempt}"
    break
  fi
  echo "HTTPS not ready yet (attempt ${attempt}/18)..."
  if [[ "$attempt" -eq 18 ]]; then
    echo "HTTPS still failing after 90s"
    run_root journalctl -u caddy -n 30 --no-pager || true
    exit 1
  fi
done

echo "=== cert dates ==="
echo | openssl s_client -servername api.avtovozom.com -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -dates

echo "=== final checks ==="
curl -fsS "https://api.avtovozom.com/health"
curl -fsS -o /dev/null -w 'web:%{http_code}\n' "https://avtovozom.com/"
