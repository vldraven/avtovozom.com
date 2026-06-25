#!/usr/bin/env bash
# Запуск n8n-mcp для Cursor: читает N8N_* из корневого .env (ключи не в git).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${N8N_PUBLIC_BASE_URL:?Задайте N8N_PUBLIC_BASE_URL в .env}"
: "${N8N_API_KEY:?Задайте N8N_API_KEY в .env}"

export N8N_API_URL="${N8N_PUBLIC_BASE_URL%/}"
export MCP_MODE=stdio
export LOG_LEVEL=error
export DISABLE_CONSOLE_OUTPUT=true

exec npx -y n8n-mcp
