"""OAuth и HTTP-клиент Avito Autoload / Item API."""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)

AVITO_API_BASE = "https://api.avito.ru"
_TOKEN_CACHE: dict[str, Any] = {"token": "", "expires_at": 0.0}
_USER_ID_CACHE: int | None = None


class AvitoApiError(Exception):
    def __init__(self, message: str, *, status_code: int | None = None, payload: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


@dataclass
class AvitoUploadItemStatus:
    ad_id: str
    avito_id: int | None
    status: str | None
    url: str | None
    errors: list[str]


def _client_id() -> str:
    return (os.getenv("AVITO_CLIENT_ID") or "").strip()


def _client_secret() -> str:
    return (os.getenv("AVITO_CLIENT_SECRET") or "").strip()


def avito_configured() -> bool:
    return bool(_client_id() and _client_secret())


def get_access_token(*, force_refresh: bool = False) -> str:
    if not avito_configured():
        raise AvitoApiError("AVITO_CLIENT_ID / AVITO_CLIENT_SECRET не заданы")

    now = time.time()
    if not force_refresh and _TOKEN_CACHE["token"] and _TOKEN_CACHE["expires_at"] > now + 60:
        return str(_TOKEN_CACHE["token"])

    try:
        r = httpx.post(
            f"{AVITO_API_BASE}/token",
            data={
                "grant_type": "client_credentials",
                "client_id": _client_id(),
                "client_secret": _client_secret(),
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=30.0,
        )
    except httpx.HTTPError as e:
        raise AvitoApiError(f"Ошибка сети при получении токена Avito: {e!s}") from e

    if r.status_code >= 400:
        raise AvitoApiError(
            f"Avito token HTTP {r.status_code}: {(r.text or '')[:400]}",
            status_code=r.status_code,
        )

    data = r.json()
    token = str(data.get("access_token") or "")
    if not token:
        raise AvitoApiError("Avito token: пустой access_token")

    expires_in = int(data.get("expires_in") or 86400)
    _TOKEN_CACHE["token"] = token
    _TOKEN_CACHE["expires_at"] = now + max(expires_in - 120, 300)
    return token


def _auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {get_access_token()}"}


def get_user_id(*, force_refresh: bool = False) -> int:
    global _USER_ID_CACHE

    env_uid = (os.getenv("AVITO_USER_ID") or "").strip()
    if env_uid.isdigit() and not force_refresh:
        return int(env_uid)

    if _USER_ID_CACHE is not None and not force_refresh:
        return _USER_ID_CACHE

    try:
        r = httpx.get(
            f"{AVITO_API_BASE}/core/v1/accounts/self",
            headers=_auth_headers(),
            timeout=30.0,
        )
    except httpx.HTTPError as e:
        raise AvitoApiError(f"Ошибка сети Avito accounts/self: {e!s}") from e

    if r.status_code >= 400:
        raise AvitoApiError(
            f"Avito accounts/self HTTP {r.status_code}: {(r.text or '')[:400]}",
            status_code=r.status_code,
        )

    data = r.json()
    uid = data.get("id")
    if uid is None:
        raise AvitoApiError("Avito accounts/self: нет поля id")
    _USER_ID_CACHE = int(uid)
    return _USER_ID_CACHE


def trigger_upload() -> dict[str, Any]:
    """POST /autoload/v1/upload — запуск загрузки фида из настроек профиля."""
    try:
        r = httpx.post(
            f"{AVITO_API_BASE}/autoload/v1/upload",
            headers=_auth_headers(),
            timeout=60.0,
        )
    except httpx.HTTPError as e:
        raise AvitoApiError(f"Ошибка сети Avito upload: {e!s}") from e

    if r.status_code >= 400:
        raise AvitoApiError(
            f"Avito upload HTTP {r.status_code}: {(r.text or '')[:500]}",
            status_code=r.status_code,
        )

    if r.text.strip():
        try:
            return r.json()
        except Exception:
            return {"raw": r.text[:500]}
    return {"ok": True}


def get_avito_ids_by_ad_ids(ad_ids: list[str]) -> dict[str, int | None]:
    if not ad_ids:
        return {}
    query = ",".join(ad_ids)
    try:
        r = httpx.get(
            f"{AVITO_API_BASE}/autoload/v2/items/avito_ids",
            params={"query": query},
            headers=_auth_headers(),
            timeout=30.0,
        )
    except httpx.HTTPError as e:
        raise AvitoApiError(f"Ошибка сети Avito avito_ids: {e!s}") from e

    if r.status_code >= 400:
        raise AvitoApiError(
            f"Avito avito_ids HTTP {r.status_code}: {(r.text or '')[:400]}",
            status_code=r.status_code,
        )

    data = r.json()
    out: dict[str, int | None] = {}
    for item in data.get("items") or []:
        if not isinstance(item, dict):
            continue
        ad_id = str(item.get("ad_id") or "")
        avito_id = item.get("avito_id")
        out[ad_id] = int(avito_id) if avito_id is not None else None
    return out


def _parse_upload_items_payload(data: Any) -> list[AvitoUploadItemStatus]:
    items_raw: list[Any] = []
    if isinstance(data, dict):
        if isinstance(data.get("items"), list):
            items_raw = data["items"]
        elif isinstance(data.get("result"), dict) and isinstance(data["result"].get("items"), list):
            items_raw = data["result"]["items"]

    out: list[AvitoUploadItemStatus] = []
    for row in items_raw:
        if not isinstance(row, dict):
            continue
        ad_id = str(row.get("ad_id") or row.get("adId") or row.get("id") or "")
        avito_raw = row.get("avito_id") or row.get("avitoId")
        avito_id = int(avito_raw) if avito_raw is not None else None
        url = row.get("url") or row.get("avito_url") or row.get("link")
        status = row.get("status") or row.get("item_status")
        errors: list[str] = []
        for err in row.get("errors") or row.get("error_messages") or []:
            if isinstance(err, str):
                errors.append(err)
            elif isinstance(err, dict):
                msg = err.get("message") or err.get("description") or str(err)
                errors.append(str(msg))
        if isinstance(row.get("error"), str):
            errors.append(row["error"])
        out.append(
            AvitoUploadItemStatus(
                ad_id=ad_id,
                avito_id=avito_id,
                status=str(status) if status is not None else None,
                url=str(url) if url else None,
                errors=errors,
            )
        )
    return out


def _get_upload_items_v4(path_suffix: str) -> list[AvitoUploadItemStatus]:
    user_id = get_user_id()
    url = f"{AVITO_API_BASE}/autoload/v4/accounts/{user_id}/uploads/{path_suffix}/items"
    try:
        r = httpx.get(url, headers=_auth_headers(), timeout=45.0)
    except httpx.HTTPError as e:
        raise AvitoApiError(f"Ошибка сети Avito {path_suffix}: {e!s}") from e

    if r.status_code == 404:
        return []
    if r.status_code >= 400:
        raise AvitoApiError(
            f"Avito {path_suffix} HTTP {r.status_code}: {(r.text or '')[:400]}",
            status_code=r.status_code,
        )
    try:
        data = r.json()
    except Exception:
        return []
    return _parse_upload_items_payload(data)


def get_last_successful_upload_items() -> list[AvitoUploadItemStatus]:
    items = _get_upload_items_v4("last_successful")
    if items:
        return items
    return _get_upload_items_v4("last-successful")


def get_current_upload_items() -> list[AvitoUploadItemStatus]:
    items = _get_upload_items_v4("current")
    if items:
        return items
    return _get_upload_items_v4("current")


def get_item_info(avito_item_id: int) -> dict[str, Any]:
    user_id = get_user_id()
    try:
        r = httpx.get(
            f"{AVITO_API_BASE}/core/v1/accounts/{user_id}/items/{avito_item_id}/",
            headers=_auth_headers(),
            timeout=30.0,
        )
    except httpx.HTTPError as e:
        raise AvitoApiError(f"Ошибка сети Avito item info: {e!s}") from e

    if r.status_code >= 400:
        raise AvitoApiError(
            f"Avito item info HTTP {r.status_code}: {(r.text or '')[:400]}",
            status_code=r.status_code,
        )
    return r.json()


def resolve_item_status(ad_id: str) -> AvitoUploadItemStatus | None:
    """Статус объявления: v4 upload items, затем avito_ids mapping."""
    target = ad_id.strip()
    if not target:
        return None

    for fetch in (get_current_upload_items, get_last_successful_upload_items):
        try:
            for item in fetch():
                if item.ad_id == target:
                    return item
        except AvitoApiError as e:
            logger.warning("Avito upload items: %s", e)

    try:
        ids = get_avito_ids_by_ad_ids([target])
    except AvitoApiError as e:
        logger.warning("Avito avito_ids: %s", e)
        return AvitoUploadItemStatus(ad_id=target, avito_id=None, status=None, url=None, errors=[str(e)])

    avito_id = ids.get(target)
    url = f"https://www.avito.ru/{avito_id}" if avito_id else None
    return AvitoUploadItemStatus(
        ad_id=target,
        avito_id=avito_id,
        status="published" if avito_id else "pending",
        url=url,
        errors=[],
    )
