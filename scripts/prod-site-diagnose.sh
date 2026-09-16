#!/usr/bin/env bash
# Диагностика доступности прода: контейнеры, ресурсы, Caddy, логи, локальные тайминги.
set -euo pipefail

DEPLOY_PATH="${1:-/opt/avtovozom}"
cd "$DEPLOY_PATH"

run_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    "$@"
  fi
}

echo "=== identity / time ==="
date -u
id
hostname

echo "=== compose ps ==="
docker compose -f docker-compose.prod.yml ps || true

echo "=== docker stats (no stream) ==="
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}' 2>/dev/null || true

echo "=== disk / memory / load ==="
df -h / "$DEPLOY_PATH" 2>/dev/null || df -h /
free -h || true
uptime || true

echo "=== listening ports ==="
ss -lntp 2>/dev/null | grep -E ':(80|443|3000|8000)\s' || netstat -lntp 2>/dev/null | grep -E ':(80|443|3000|8000)' || true

echo "=== localhost timings ==="
for url in \
  'http://127.0.0.1:8000/health' \
  'http://127.0.0.1:8000/cars?limit=1&photo_limit=1' \
  'http://127.0.0.1:8000/catalog/brands' \
  'http://127.0.0.1:3000/' \
  'http://127.0.0.1:3000/catalog'
do
  curl -sS -o /tmp/prod_diag.out -w "url=$url http=%{http_code} ttfb=%{time_starttransfer}s total=%{time_total}s size=%{size_download}\n" \
    --connect-timeout 5 --max-time 45 "$url" || echo "FAIL $url"
done

echo "=== public https timings (from VPS) ==="
for url in \
  'https://api.avtovozom.com/health' \
  'https://api.avtovozom.com/cars?limit=1&photo_limit=1' \
  'https://avtovozom.com/' \
  'https://avtovozom.com/catalog'
do
  curl -sS -o /tmp/prod_diag.out -w "url=$url http=%{http_code} ttfb=%{time_starttransfer}s total=%{time_total}s size=%{size_download}\n" \
    --connect-timeout 5 --max-time 45 "$url" || echo "FAIL $url"
done

echo "=== cert dates ==="
echo | openssl s_client -servername avtovozom.com -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -subject -dates 2>/dev/null || true
echo | openssl s_client -servername api.avtovozom.com -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -subject -dates 2>/dev/null || true

echo "=== caddy status / journal ==="
run_root systemctl is-active caddy || true
run_root systemctl status caddy --no-pager -l 2>/dev/null | tail -40 || true
run_root journalctl -u caddy -n 80 --no-pager 2>/dev/null || true

echo "=== backend logs (errors / timeouts / last 120 lines) ==="
docker compose -f docker-compose.prod.yml logs --tail=400 backend 2>&1 | \
  grep -iE 'error|traceback|exception|timeout|timed out|worker|killed|oom|memory|FATAL|WARNING|uvicorn|started' | tail -120 || true
echo "=== backend raw tail ==="
docker compose -f docker-compose.prod.yml logs --tail=80 backend 2>&1 || true

echo "=== web logs (errors / last 80) ==="
docker compose -f docker-compose.prod.yml logs --tail=250 web 2>&1 | \
  grep -iE 'error|traceback|exception|timeout|ECONN|ENOTFOUND|500|failed|fetch' | tail -80 || true
echo "=== web raw tail ==="
docker compose -f docker-compose.prod.yml logs --tail=60 web 2>&1 || true

echo "=== parser recent status ==="
docker compose -f docker-compose.prod.yml logs --tail=40 parser 2>&1 || true

echo "=== dmesg OOM / kill (if readable) ==="
run_root dmesg -T 2>/dev/null | grep -iE 'oom|killed process|out of memory' | tail -20 || true

echo "=== recent parse_jobs ==="
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U avtovozom -d avtovozom -c \
  "SELECT id, type, status, total_errors, left(coalesce(message,''),160) AS msg, started_at, finished_at FROM parse_jobs ORDER BY id DESC LIMIT 10;" \
  2>/dev/null || true

echo "=== done ==="
