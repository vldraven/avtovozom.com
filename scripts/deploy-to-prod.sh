#!/usr/bin/env bash
# Синхронизация кода на VPS и пересборка Docker. Не трогает на сервере .env и media/.
# Требуется: ssh-доступ, на сервере установлены Docker и docker compose plugin.
#
#   export DEPLOY_HOST=91.196.33.68
#   export DEPLOY_USER=root
#   export DEPLOY_PATH=/opt/avtovozom   # опционально
#   ./scripts/deploy-to-prod.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${DEPLOY_HOST:?Укажите DEPLOY_HOST (IP или домен сервера)}"
USER="${DEPLOY_USER:-root}"
REMOTE="${DEPLOY_PATH:-/opt/avtovozom}"
TARGET="${USER}@${HOST}:${REMOTE}/"

echo "==> rsync → ${TARGET}"
rsync -avz \
  --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'web/.next/' \
  --exclude 'web/node_modules/' \
  --exclude '__pycache__/' \
  --exclude '*.pyc' \
  --exclude '.env' \
  --exclude 'backups/' \
  --exclude 'media/' \
  --exclude '.cursor/' \
  --exclude '.DS_Store' \
  "${ROOT}/" "${TARGET}"

echo "==> docker compose up -d --build на ${HOST}"
ssh -o BatchMode=yes "${USER}@${HOST}" bash -s <<EOF
set -euo pipefail
cd "${REMOTE}"
if [ -f docker-compose.prod.yml ]; then
  docker compose -f docker-compose.prod.yml up -d --build
else
  docker compose up -d --build
fi
docker compose ps
EOF

echo "==> Готово."
