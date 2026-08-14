#!/usr/bin/env bash
# Синхронизация кода на VPS и пересборка Docker. Не трогает на сервере .env и media/.
# Требуется: ssh-доступ, на сервере установлены Docker и docker compose plugin.
#
#   export DEPLOY_HOST=91.196.33.68
#   export DEPLOY_USER=root
#   export DEPLOY_PATH=/opt/avtovozom   # опционально
#   ./scripts/deploy-to-prod.sh
#
# По умолчанию отказывается, если дерево грязное или HEAD ≠ origin/main
# (иначе rsync --delete затирает прод-only hotfix из другого чата).
# Аварийный обход: DEPLOY_FORCE=1

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${DEPLOY_HOST:?Укажите DEPLOY_HOST (IP или домен сервера)}"
USER="${DEPLOY_USER:-root}"
REMOTE="${DEPLOY_PATH:-/opt/avtovozom}"
TARGET="${USER}@${HOST}:${REMOTE}/"

cd "$ROOT"
if [[ "${DEPLOY_FORCE:-}" != "1" ]]; then
  git fetch origin main >/dev/null 2>&1 || true
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Отказ: грязное git-дерево. Закоммитьте изменения и влейте в main, затем деплойте."
    echo "Иначе rsync --delete сотрёт на проде то, чего нет в этой папке."
    echo "Аварийный обход: DEPLOY_FORCE=1 $0"
    exit 1
  fi
  HEAD="$(git rev-parse HEAD)"
  MAIN="$(git rev-parse origin/main 2>/dev/null || true)"
  if [[ -z "$MAIN" || "$HEAD" != "$MAIN" ]]; then
    echo "Отказ: HEAD не совпадает с origin/main."
    echo "Прод собирается только из main (PR → merge). Не деплойте ветку/worktree."
    echo "Аварийный обход: DEPLOY_FORCE=1 $0"
    exit 1
  fi
else
  echo "Внимание: DEPLOY_FORCE=1 — проверки git пропущены."
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
echo "==> снимок search_profiles → ${REMOTE}/backups/search_profiles-${STAMP}.sql"
ssh -o BatchMode=yes "${USER}@${HOST}" bash -s <<EOF || echo "Предупреждение: не удалось снять search_profiles"
set -euo pipefail
mkdir -p "${REMOTE}/backups"
docker exec avtovozom_postgres sh -c 'pg_dump -U "\$POSTGRES_USER" -d "\$POSTGRES_DB" -t search_profiles --data-only --column-inserts' > "${REMOTE}/backups/search_profiles-${STAMP}.sql"
EOF

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
  --exclude '.seo-hero-worktree/' \
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
