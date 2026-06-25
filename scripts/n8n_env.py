"""Load N8N_* variables from project .env (stdlib only)."""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_dotenv() -> None:
    env_path = ROOT / ".env"
    if not env_path.is_file():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def require_n8n_config() -> tuple[str, str]:
    load_dotenv()
    base = os.environ.get("N8N_PUBLIC_BASE_URL", "").rstrip("/")
    key = os.environ.get("N8N_API_KEY", "")
    if not base or not key:
        raise SystemExit(
            "Нужны N8N_PUBLIC_BASE_URL и N8N_API_KEY в .env "
            "(см. deploy/N8N_CURSOR_SETUP_RU.md)"
        )
    return base, key
