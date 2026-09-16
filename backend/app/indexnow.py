"""IndexNow — мгновенное уведомление поисковиков (Яндекс, Bing) об изменении URL.

Принцип работы строго «best-effort»: ни отсутствие ключа, ни сетевые ошибки
не должны влиять на основной HTTP-запрос или работу парсера. Отправка идёт
в фоновом потоке-демоне, исключения только логируются.

Ключ задаётся переменной окружения ``INDEXNOW_KEY``. Файл-подтверждение ключа
раздаёт фронтенд (Next.js) по адресу ``INDEXNOW_KEY_LOCATION`` — по умолчанию
``{PUBLIC_WEB_ORIGIN}/indexnow-key.txt``.
"""

from __future__ import annotations

import logging
import os
import threading
import urllib.parse

import httpx

logger = logging.getLogger(__name__)

# Любой участник протокола IndexNow рассылает пинг остальным поисковикам;
# берём эндпоинт Яндекса как приоритетный для нашей аудитории.
_ENDPOINT = "https://yandex.com/indexnow"
_TIMEOUT = 10.0
_MAX_URLS = 10000


def _key() -> str:
    return (os.getenv("INDEXNOW_KEY") or "").strip()


def web_origin() -> str:
    raw = os.getenv("PUBLIC_WEB_ORIGIN") or os.getenv("NEXT_PUBLIC_SITE_URL") or ""
    return raw.strip().rstrip("/")


def _web_origin() -> str:
    return web_origin()


def _key_location(origin: str) -> str:
    explicit = (os.getenv("INDEXNOW_KEY_LOCATION") or "").strip()
    return explicit or f"{origin}/indexnow-key.txt"


def _payload(urls: list[str]) -> dict | None:
    key = _key()
    origin = _web_origin()
    clean = list(dict.fromkeys(u.strip() for u in urls if u and u.strip()))
    if not key or not origin.startswith("http") or not clean:
        return None
    host = urllib.parse.urlsplit(origin).netloc
    if not host:
        return None
    return {
        "host": host,
        "key": key,
        "keyLocation": _key_location(origin),
        "urlList": clean[:_MAX_URLS],
    }


def post_urls_blocking(urls: list[str], *, timeout: float = 30.0) -> tuple[int, str]:
    """Синхронный POST. Возвращает (http_status, краткий комментарий). 0 — не отправляли."""
    payload = _payload(urls)
    if not payload:
        return 0, "skip: нет INDEXNOW_KEY, origin или URL"
    try:
        resp = httpx.post(_ENDPOINT, json=payload, timeout=timeout)
        n = len(payload["urlList"])
        if resp.status_code >= 400:
            logger.warning(
                "IndexNow ответил %s на %d URL: %s",
                resp.status_code,
                n,
                resp.text[:300],
            )
            return resp.status_code, resp.text[:300]
        logger.info("IndexNow принял %d URL (%s)", n, resp.status_code)
        return resp.status_code, f"ok {n} urls"
    except Exception as exc:  # noqa: BLE001
        logger.warning("IndexNow: ошибка отправки: %s", exc)
        return 0, str(exc)


def submit_urls(urls: list[str]) -> None:
    """Отправить абсолютные URL в IndexNow. Не блокирует вызывающий код и не бросает исключений."""
    if _payload(urls) is None:
        return

    def _worker() -> None:
        post_urls_blocking(urls, timeout=_TIMEOUT)

    threading.Thread(target=_worker, name="indexnow", daemon=True).start()


def car_url(db, car) -> str | None:
    """Канонический абсолютный URL объявления для IndexNow (или None, если origin не настроен)."""
    origin = _web_origin()
    if not origin:
        return None
    try:
        from .catalog_slug import build_catalog_slug_maps, slugs_for_car

        bmap, mmap = build_catalog_slug_maps(db)
        brand_slug, model_slug = slugs_for_car(car, bmap, mmap)
        if brand_slug and model_slug:
            return f"{origin}/catalog/{brand_slug}/{model_slug}/{car.id}"
        return f"{origin}/cars/{car.id}"
    except Exception as exc:  # noqa: BLE001 — best-effort
        logger.warning("IndexNow: не удалось построить URL для car %s: %s", getattr(car, "id", "?"), exc)
        return None


def submit_car(db, car) -> None:
    """Пингануть IndexNow по каноническому URL одного объявления (создание/обновление/снятие)."""
    url = car_url(db, car)
    if url:
        submit_urls([url])
