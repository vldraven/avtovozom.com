#!/usr/bin/env bash
# Подтянуть каталог media/ с VPS (те же DEPLOY_* что и для deploy-to-prod.sh).
# Нужен SSH по ключу. Не трогает .env.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${DEPLOY_HOST:?Укажите DEPLOY_HOST}"
USER="${DEPLOY_USER:-root}"
REMOTE="${DEPLOY_PATH:-/opt/avtovozom}"

mkdir -p "${ROOT}/media"
echo "==> rsync media ← ${USER}@${HOST}:${REMOTE}/media/"
rsync -avz --progress \
  "${USER}@${HOST}:${REMOTE}/media/" \
  "${ROOT}/media/"

echo "==> Готово: ${ROOT}/media"
