"""Яндекс.Вебмастер API: переобход ключевых URL в пределах суточной квоты.

Токен: OAuth приложения с правом webmaster (env YANDEX_WEBMASTER_TOKEN).
Документация: https://yandex.com/dev/webmaster/doc/ru/reference/host-recrawl-post
"""

from __future__ import annotations

import logging
import os
import urllib.parse

import httpx

logger = logging.getLogger(__name__)

_API = "https://api.webmaster.yandex.net/v4"
_TIMEOUT = 20.0


def _token() -> str:
    return (os.getenv("YANDEX_WEBMASTER_TOKEN") or "").strip()


def enabled() -> bool:
    return bool(_token())


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"OAuth {_token()}",
        "Content-Type": "application/json",
    }


def _client() -> httpx.Client:
    return httpx.Client(timeout=_TIMEOUT, headers=_headers())


def _host_url(user_id: int, host_id: str, suffix: str) -> str:
    # host_id вида https:avtovozom.com:443 — в path как в документации Яндекса.
    return f"{_API}/user/{user_id}/hosts/{host_id}{suffix}"


def fetch_user_id(client: httpx.Client | None = None) -> int | None:
    explicit = (os.getenv("YANDEX_WEBMASTER_USER_ID") or "").strip()
    if explicit.isdigit():
        return int(explicit)
    own = client or _client()
    try:
        r = own.get(f"{_API}/user")
        r.raise_for_status()
        data = r.json()
        uid = data.get("user_id") or data.get("id")
        return int(uid) if uid is not None else None
    except Exception as exc:  # noqa: BLE001
        logger.warning("Webmaster user-id: %s", exc)
        return None
    finally:
        if client is None:
            own.close()


def _host_matches(host: dict, want_netloc: str) -> bool:
    hid = str(host.get("host_id") or "")
    ascii_host = str(host.get("ascii_host_url") or host.get("unicode_host_url") or "")
    netloc = urllib.parse.urlsplit(ascii_host).netloc.lower().removeprefix("www.")
    if not want_netloc:
        return False
    return want_netloc in netloc or want_netloc in hid.lower()


def fetch_host_id(user_id: int, origin: str, client: httpx.Client | None = None) -> str | None:
    explicit = (os.getenv("YANDEX_WEBMASTER_HOST_ID") or "").strip()
    if explicit:
        return explicit
    want = urllib.parse.urlsplit(origin).netloc.lower().removeprefix("www.")
    own = client or _client()
    try:
        r = own.get(f"{_API}/user/{user_id}/hosts")
        r.raise_for_status()
        hosts = r.json().get("hosts") or []
        for host in hosts:
            if _host_matches(host, want):
                return str(host.get("host_id") or "")
        if len(hosts) == 1:
            return str(hosts[0].get("host_id") or "") or None
        logger.warning("Webmaster: не нашли host для %s среди %d", origin, len(hosts))
        return None
    except Exception as exc:  # noqa: BLE001
        logger.warning("Webmaster hosts: %s", exc)
        return None
    finally:
        if client is None:
            own.close()


def list_hosts(user_id: int, client: httpx.Client | None = None) -> list[dict]:
    own = client or _client()
    try:
        r = own.get(f"{_API}/user/{user_id}/hosts")
        r.raise_for_status()
        return list(r.json().get("hosts") or [])
    except Exception as exc:  # noqa: BLE001
        logger.warning("Webmaster hosts: %s", exc)
        return []
    finally:
        if client is None:
            own.close()


def fetch_quota(user_id: int, host_id: str, client: httpx.Client | None = None) -> dict:
    own = client or _client()
    try:
        r = own.get(_host_url(user_id, host_id, "/recrawl/quota"))
        r.raise_for_status()
        data = r.json()
        return {
            "daily_quota": int(data.get("daily_quota") or 0),
            "quota_remainder": int(data.get("quota_remainder") or 0),
        }
    except Exception as exc:  # noqa: BLE001
        logger.warning("Webmaster quota: %s", exc)
        return {"daily_quota": 0, "quota_remainder": 0}
    finally:
        if client is None:
            own.close()


def enqueue_recrawl(user_id: int, host_id: str, url: str, client: httpx.Client | None = None) -> str:
    """Ставит URL в очередь. Возвращает 'ok' / 'already' / 'quota' / текст ошибки."""
    own = client or _client()
    try:
        r = own.post(
            _host_url(user_id, host_id, "/recrawl/queue"),
            json={"url": url},
        )
        if r.status_code == 429:
            return "quota"
        if r.status_code == 409:
            return "already"
        if r.status_code >= 400:
            try:
                code = (r.json() or {}).get("error_code") or ""
            except Exception:  # noqa: BLE001
                code = ""
            if str(code).upper() in {"URL_ALREADY_ADDED", "ALREADY_IN_QUEUE"}:
                return "already"
            if str(code).upper() == "QUOTA_EXCEEDED":
                return "quota"
            return f"http {r.status_code}: {r.text[:200]}"
        return "ok"
    except Exception as exc:  # noqa: BLE001
        return str(exc)
    finally:
        if client is None:
            own.close()


def fetch_indexing_summary(user_id: int, host_id: str, client: httpx.Client | None = None) -> str:
    """Короткий текст для отчёта. Если API недоступен — пустая строка."""
    own = client or _client()
    try:
        r = own.get(_host_url(user_id, host_id, "/summary"))
        if r.status_code >= 400:
            return ""
        data = r.json() or {}
        parts: list[str] = []
        if data.get("searchable_pages_count") is not None:
            parts.append(f"в поиске: {data['searchable_pages_count']}")
        if data.get("excluded_pages_count") is not None:
            parts.append(f"исключено: {data['excluded_pages_count']}")
        if data.get("sqi") is not None:
            parts.append(f"ИКС: {data['sqi']}")
        return ", ".join(parts)
    except Exception:  # noqa: BLE001
        return ""
    finally:
        if client is None:
            own.close()


def recrawl_urls(urls: list[str], origin: str, *, limit: int | None = None) -> dict:
    """Переобход списка URL в пределах квоты. Не бросает наружу."""
    empty = {
        "skipped": False,
        "reason": "",
        "ok": 0,
        "already": 0,
        "errors": 0,
        "quota": {"daily_quota": 0, "quota_remainder": 0},
        "sent": [],
        "summary": "",
    }
    if not enabled():
        empty["skipped"] = True
        empty["reason"] = "нет YANDEX_WEBMASTER_TOKEN"
        return empty
    clean = list(dict.fromkeys(u.strip() for u in urls if u and u.strip()))
    if not clean:
        empty["skipped"] = True
        empty["reason"] = "нет URL"
        return empty
    cap = limit if limit is not None else int(os.getenv("SEO_RECRAWL_MAX", "15") or 15)
    cap = max(0, cap)
    with _client() as client:
        user_id = fetch_user_id(client)
        if not user_id:
            empty["skipped"] = True
            empty["reason"] = "не удалось получить user_id"
            return empty
        host_id = fetch_host_id(user_id, origin, client)
        if not host_id:
            empty["skipped"] = True
            empty["reason"] = "не удалось получить host_id"
            return empty
        quota = fetch_quota(user_id, host_id, client)
        remainder = int(quota.get("quota_remainder") or 0)
        take = min(cap, remainder, len(clean))
        result = {
            **empty,
            "quota": quota,
            "user_id": user_id,
            "host_id": host_id,
            "summary": fetch_indexing_summary(user_id, host_id, client),
        }
        if take <= 0:
            result["skipped"] = True
            result["reason"] = "квота переобхода исчерпана или SEO_RECRAWL_MAX=0"
            return result
        sent: list[str] = []
        for url in clean[:take]:
            status = enqueue_recrawl(user_id, host_id, url, client)
            if status == "ok":
                result["ok"] += 1
                sent.append(url)
            elif status == "already":
                result["already"] += 1
                sent.append(url)
            elif status == "quota":
                result["reason"] = "квота исчерпана в процессе"
                break
            else:
                result["errors"] += 1
                logger.warning("Webmaster recrawl %s: %s", url, status)
        result["sent"] = sent
        return result
