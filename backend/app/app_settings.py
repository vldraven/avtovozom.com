"""Ключевые настройки приложения (админские секреты с ротацией)."""

from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AppSetting

VK_USER_TOKEN_KEY = "vk_user_access_token"
VK_USER_TOKEN_EXPIRES_KEY = "vk_user_access_token_expires_at"
DEFAULT_VK_OAUTH_CLIENT_ID = "54689021"


def get_setting(db: Session, key: str) -> str:
    row = db.execute(select(AppSetting).where(AppSetting.key == key)).scalar_one_or_none()
    return (row.value if row else "") or ""


def set_setting(db: Session, key: str, value: str) -> None:
    row = db.execute(select(AppSetting).where(AppSetting.key == key)).scalar_one_or_none()
    if row is None:
        row = AppSetting(key=key, value=value or "")
        db.add(row)
    else:
        row.value = value or ""
        row.updated_at = datetime.utcnow()
    db.flush()


def get_vk_user_token(db: Session) -> tuple[str, datetime | None]:
    token = get_setting(db, VK_USER_TOKEN_KEY).strip()
    raw_exp = get_setting(db, VK_USER_TOKEN_EXPIRES_KEY).strip()
    expires_at: datetime | None = None
    if raw_exp:
        try:
            expires_at = datetime.fromisoformat(raw_exp.replace("Z", ""))
        except ValueError:
            expires_at = None
    return token, expires_at


def set_vk_user_token(
    db: Session,
    token: str,
    *,
    expires_in: int | None = 86400,
) -> datetime | None:
    cleaned = (token or "").strip()
    if cleaned.startswith("#"):
        # pasted fragment accidentally
        cleaned = cleaned.lstrip("#")
    if "access_token=" in cleaned:
        # pasted full redirect URL
        from urllib.parse import parse_qs, urlparse

        parsed = urlparse(cleaned)
        bag = parse_qs(parsed.fragment or parsed.query)
        vals = bag.get("access_token") or []
        if vals:
            cleaned = vals[0].strip()
        exp_vals = bag.get("expires_in") or []
        if exp_vals and expires_in is None:
            try:
                expires_in = int(exp_vals[0])
            except ValueError:
                pass

    if not cleaned:
        set_setting(db, VK_USER_TOKEN_KEY, "")
        set_setting(db, VK_USER_TOKEN_EXPIRES_KEY, "")
        db.commit()
        return None

    expires_at: datetime | None = None
    if expires_in is not None and int(expires_in) > 0:
        expires_at = datetime.utcnow() + timedelta(seconds=int(expires_in))
        set_setting(db, VK_USER_TOKEN_EXPIRES_KEY, expires_at.isoformat(timespec="seconds"))
    else:
        set_setting(db, VK_USER_TOKEN_EXPIRES_KEY, "")

    set_setting(db, VK_USER_TOKEN_KEY, cleaned)
    db.commit()
    return expires_at


def mask_token(token: str) -> str:
    t = (token or "").strip()
    if not t:
        return ""
    if len(t) <= 16:
        return t[:4] + "…"
    return f"{t[:10]}…{t[-6:]}"


def vk_oauth_authorize_url(*, scope: str = "photos") -> str:
    """Implicit Flow (IP браузера) — fallback для ручной вставки."""
    from .vk_oauth import implicit_oauth_url_for_docs

    return implicit_oauth_url_for_docs(scope=scope)


def vk_user_token_status(db: Session) -> dict[str, Any]:
    from .vk_oauth import vk_oauth_mode, vk_oauth_redirect_uri

    token, expires_at = get_vk_user_token(db)
    env_fallback = (os.getenv("VK_USER_ACCESS_TOKEN") or "").strip()
    effective = token or env_fallback
    source = "db" if token else ("env" if env_fallback else None)
    expired = False
    if expires_at is not None:
        expired = datetime.utcnow() >= expires_at
    return {
        "configured": bool(effective),
        "source": source,
        "preview": mask_token(effective) if effective else "",
        "expires_at": expires_at.isoformat(timespec="seconds") + "Z" if expires_at else None,
        "expired": expired,
        "oauth_url": vk_oauth_authorize_url(),
        "oauth_redirect_uri": vk_oauth_redirect_uri(),
        "oauth_mode": vk_oauth_mode(),
    }
