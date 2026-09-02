#!/usr/bin/env bash
# Починка HTTPS на проде: перезапуск Caddy и проверка сертификатов.
# Вызывается из GitHub Actions по SSH (DEPLOY_USER обычно root).
set -euo pipefail

DEPLOY_PATH="${1:-/opt/avtovozom}"
CADDYFILE="/etc/caddy/Caddyfile"

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

echo "=== caddy binary ==="
command -v caddy || true

if [[ -f "${DEPLOY_PATH}/deploy/Caddyfile" ]]; then
  run_root mkdir -p /etc/caddy
  if [[ ! -f "$CADDYFILE" ]]; then
    echo "Installing Caddyfile from repo..."
    sed 's/you@example.com/noreply@avtovozom.com/' "${DEPLOY_PATH}/deploy/Caddyfile" | run_root tee "$CADDYFILE" >/dev/null
  else
    echo "Caddyfile exists at $CADDYFILE — keeping server copy"
  fi
fi

if [[ -f "$CADDYFILE" ]]; then
  echo "=== validate Caddyfile ==="
  run_root caddy validate --config "$CADDYFILE"
fi

echo "=== caddy before ==="
run_root systemctl status caddy --no-pager -l || true

echo "=== restart caddy ==="
run_root systemctl enable caddy 2>/dev/null || true
run_root systemctl restart caddy

sleep 5

echo "=== caddy after ==="
run_root systemctl is-active caddy
run_root systemctl status caddy --no-pager -l

echo "=== caddy journal (last 50 lines) ==="
run_root journalctl -u caddy -n 50 --no-pager

echo "=== app health (localhost) ==="
curl -fsS http://127.0.0.1:8000/health
curl -fsS -o /dev/null -w 'web:%{http_code}\n' http://127.0.0.1:3000/

echo "=== https health ==="
curl -fsS https://api.avtovozom.com/health

echo "=== cert dates ==="
echo | openssl s_client -servername api.avtovozom.com -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -dates
