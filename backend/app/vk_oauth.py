"""Server-side VK OAuth для user-токена фото (тот же egress IP, что у photos.*)."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import secrets
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
from sqlalchemy.orm import Session

from .app_settings import (
    DEFAULT_VK_OAUTH_CLIENT_ID,
    get_setting,
    set_setting,
    set_vk_user_token,
)

log = logging.getLogger(__name__)

VK_ID_AUTHORIZE = "https://id.vk.ru/authorize"
VK_ID_TOKEN = "https://id.vk.ru/oauth2/auth"
VK_CLASSIC_AUTHORIZE = "https://oauth.vk.com/authorize"
VK_CLASSIC_TOKEN = "https://oauth.vk.com/access_token"

PENDING_KEY = "vk_oauth_pending"
DEFAULT_SCOPE_ID = "vkid.personal_info photos"
DEFAULT_SCOPE_CLASSIC = "photos"
PENDING_TTL_SEC = 15 * 60


class VkOAuthError(RuntimeError):
    pass


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def make_pkce() -> tuple[str, str]:
    verifier = _b64url(secrets.token_bytes(32))
    challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    return verifier, challenge


def vk_oauth_redirect_uri() -> str:
    explicit = (os.getenv("VK_OAUTH_REDIRECT_URI") or "").strip()
    if explicit:
        return explicit.rstrip("/")
    api = (
        os.getenv("PUBLIC_API_ORIGIN")
        or os.getenv("NEXT_PUBLIC_API_URL")
        or "http://localhost:8000"
    ).rstrip("/")
    return f"{api}/admin/integrations/vk/oauth/callback"


def vk_oauth_client_id() -> str:
    return (os.getenv("VK_OAUTH_CLIENT_ID") or DEFAULT_VK_OAUTH_CLIENT_ID).strip()


def vk_oauth_client_secret() -> str:
    return (os.getenv("VK_OAUTH_CLIENT_SECRET") or "").strip()


def vk_oauth_mode() -> str:
    """
    classic — oauth.vk.com + client_secret (предпочтительный путь для photos).
    vkid — id.vk.ru PKCE; у многих mini-app страница authorize падает с «Ошибка загрузки».
    """
    mode = (os.getenv("VK_OAUTH_MODE") or "").strip().lower()
    if mode in ("classic", "vkid"):
        return mode
    # По умолчанию classic: Implicit/oauth.vk.com у приложения уже работал.
    return "classic"


def safe_return_to(raw: str | None) -> str:
    path = (raw or "").strip() or "/staff/publish-social"
    if not path.startswith("/staff/"):
        return "/staff/publish-social"
    if "://" in path or path.startswith("//") or "\\" in path:
        return "/staff/publish-social"
    return path.split("?")[0].split("#")[0][:240]


def begin_vk_oauth(db: Session, *, return_to: str | None = None) -> dict[str, str]:
    client_id = vk_oauth_client_id()
    redirect_uri = vk_oauth_redirect_uri()
    mode = vk_oauth_mode()
    state = secrets.token_urlsafe(24)
    pending: dict[str, Any] = {
        "state": state,
        "mode": mode,
        "return_to": safe_return_to(return_to),
        "redirect_uri": redirect_uri,
        "exp": (datetime.utcnow() + timedelta(seconds=PENDING_TTL_SEC)).isoformat(),
    }

    if mode == "classic":
        if not vk_oauth_client_secret():
            raise VkOAuthError(
                "На сервере нет VK_OAUTH_CLIENT_SECRET. "
                "В кабинете приложения (vk.com/apps → ваше приложение → Настройки) "
                "скопируйте «Защищённый ключ» в /opt/avtovozom/.env как "
                "VK_OAUTH_CLIENT_SECRET=… и перезапустите backend. "
                "Также добавьте Authorized redirect URI: "
                f"{redirect_uri}"
            )
        q = urlencode(
            {
                "client_id": client_id,
                "display": "page",
                "redirect_uri": redirect_uri,
                "scope": DEFAULT_SCOPE_CLASSIC,
                "response_type": "code",
                "state": state,
                "v": "5.199",
            }
        )
        authorize_url = f"{VK_CLASSIC_AUTHORIZE}?{q}"
    else:
        verifier, challenge = make_pkce()
        pending["code_verifier"] = verifier
        q = urlencode(
            {
                "response_type": "code",
                "client_id": client_id,
                "redirect_uri": redirect_uri,
                "state": state,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "scope": DEFAULT_SCOPE_ID,
            }
        )
        authorize_url = f"{VK_ID_AUTHORIZE}?{q}"

    set_setting(db, PENDING_KEY, json.dumps(pending, ensure_ascii=False))
    db.commit()
    return {
        "authorize_url": authorize_url,
        "redirect_uri": redirect_uri,
        "mode": mode,
    }


def _load_pending(db: Session) -> dict[str, Any]:
    raw = get_setting(db, PENDING_KEY).strip()
    if not raw:
        raise VkOAuthError("Нет активного OAuth: сначала нажмите «Подключить через сервер».")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise VkOAuthError("Повреждён pending OAuth state") from exc
    if not isinstance(data, dict):
        raise VkOAuthError("Повреждён pending OAuth state")
    exp_raw = str(data.get("exp") or "")
    try:
        exp = datetime.fromisoformat(exp_raw)
    except ValueError as exc:
        raise VkOAuthError("Истёк OAuth state") from exc
    if datetime.utcnow() > exp:
        raise VkOAuthError("OAuth state истёк — начните подключение заново.")
    return data


def _clear_pending(db: Session) -> None:
    set_setting(db, PENDING_KEY, "")
    db.commit()


def _parse_callback_params(
    *,
    code: str | None,
    state: str | None,
    device_id: str | None,
    payload: str | None,
) -> dict[str, str]:
    if payload:
        try:
            bag = json.loads(payload)
        except json.JSONDecodeError:
            bag = {}
        if isinstance(bag, dict):
            return {
                "code": str(bag.get("code") or code or "").strip(),
                "state": str(bag.get("state") or state or "").strip(),
                "device_id": str(bag.get("device_id") or device_id or "").strip(),
            }
    return {
        "code": (code or "").strip(),
        "state": (state or "").strip(),
        "device_id": (device_id or "").strip(),
    }


def _exchange_classic(*, code: str, redirect_uri: str) -> dict[str, Any]:
    params = {
        "client_id": vk_oauth_client_id(),
        "client_secret": vk_oauth_client_secret(),
        "redirect_uri": redirect_uri,
        "code": code,
    }
    with httpx.Client(timeout=30.0) as client:
        resp = client.get(VK_CLASSIC_TOKEN, params=params)
        data = resp.json()
    if not isinstance(data, dict):
        raise VkOAuthError("VK token: неожиданный ответ")
    if data.get("error"):
        raise VkOAuthError(
            f"VK token: {data.get('error_description') or data.get('error')}"
        )
    if not data.get("access_token"):
        raise VkOAuthError("VK token: нет access_token")
    return data


def _exchange_vkid(
    *,
    code: str,
    redirect_uri: str,
    code_verifier: str,
    device_id: str,
    state: str,
) -> dict[str, Any]:
    form: dict[str, str] = {
        "grant_type": "authorization_code",
        "code": code,
        "code_verifier": code_verifier,
        "client_id": vk_oauth_client_id(),
        "device_id": device_id or "avtovozom-server",
        "redirect_uri": redirect_uri,
        "state": state,
    }
    secret = vk_oauth_client_secret()
    if secret:
        form["client_secret"] = secret
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(VK_ID_TOKEN, data=form)
        try:
            data = resp.json()
        except Exception as exc:
            raise VkOAuthError(f"VK ID token: HTTP {resp.status_code}") from exc
    if not isinstance(data, dict):
        raise VkOAuthError("VK ID token: неожиданный ответ")
    if resp.status_code >= 400 or data.get("error"):
        raise VkOAuthError(
            f"VK ID token: {data.get('error_description') or data.get('error') or resp.status_code}"
        )
    if not data.get("access_token"):
        raise VkOAuthError("VK ID token: нет access_token")
    return data


def complete_vk_oauth(
    db: Session,
    *,
    code: str | None = None,
    state: str | None = None,
    device_id: str | None = None,
    payload: str | None = None,
) -> dict[str, Any]:
    pending = _load_pending(db)
    parsed = _parse_callback_params(
        code=code, state=state, device_id=device_id, payload=payload
    )
    if not parsed["code"]:
        raise VkOAuthError("В callback нет code")
    if parsed["state"] != pending.get("state"):
        raise VkOAuthError("OAuth state не совпал")

    redirect_uri = str(pending.get("redirect_uri") or vk_oauth_redirect_uri())
    mode = str(pending.get("mode") or vk_oauth_mode())
    try:
        if mode == "classic":
            token_body = _exchange_classic(code=parsed["code"], redirect_uri=redirect_uri)
        else:
            token_body = _exchange_vkid(
                code=parsed["code"],
                redirect_uri=redirect_uri,
                code_verifier=str(pending.get("code_verifier") or ""),
                device_id=parsed["device_id"],
                state=parsed["state"],
            )
    finally:
        _clear_pending(db)

    access = str(token_body.get("access_token") or "").strip()
    expires_in = token_body.get("expires_in")
    try:
        expires_in_int = int(expires_in) if expires_in is not None else 86400
    except (TypeError, ValueError):
        expires_in_int = 86400

    expires_at = set_vk_user_token(db, access, expires_in=expires_in_int)
    return {
        "ok": True,
        "return_to": safe_return_to(str(pending.get("return_to") or "")),
        "expires_at": expires_at.isoformat(timespec="seconds") + "Z" if expires_at else None,
        "preview": access[:10] + "…" + access[-6:] if len(access) > 16 else access[:4] + "…",
        "refresh_token": bool(token_body.get("refresh_token")),
        "scope": str(token_body.get("scope") or ""),
    }


def implicit_oauth_url_for_docs(*, scope: str = "photos") -> str:
    """Старый Implicit (привязан к IP браузера) — только как fallback в доке/UI."""
    q = urlencode(
        {
            "client_id": vk_oauth_client_id(),
            "display": "page",
            "redirect_uri": "https://oauth.vk.com/blank.html",
            "scope": scope,
            "response_type": "token",
            "v": "5.199",
        }
    )
    return f"{VK_CLASSIC_AUTHORIZE}?{q}"
