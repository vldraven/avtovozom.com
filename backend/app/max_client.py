"""Клиент MAX Bot API: публикация постов в публичный канал."""

from __future__ import annotations

import logging
import mimetypes
import os
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx

from .http_ssl import http_verify
from .vk_client import download_photo_to_temp

log = logging.getLogger(__name__)

DEFAULT_API_BASE = "https://platform-api2.max.ru"
MAX_CHANNEL_PHOTOS = 10


class MaxApiError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None, raw: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.raw = raw


@dataclass
class MaxConfig:
    bot_token: str
    channel_chat_id: int
    api_base: str = DEFAULT_API_BASE
    max_photos: int = MAX_CHANNEL_PHOTOS

    @property
    def auth_header(self) -> str:
        return self.bot_token.strip()


@dataclass
class MaxChannelPostResult:
    message_id: int | None
    post_url: str | None
    raw_message: dict[str, Any]


def _max_photos_limit() -> int:
    raw = (os.getenv("MAX_MAX_PHOTOS") or "").strip()
    if not raw:
        return MAX_CHANNEL_PHOTOS
    try:
        n = int(raw)
    except ValueError:
        return MAX_CHANNEL_PHOTOS
    return max(1, min(n, MAX_CHANNEL_PHOTOS))


def _clean_env(value: str | None) -> str:
    return (value or "").strip().strip('"').strip("'").strip()


def load_max_config_from_env() -> MaxConfig | None:
    token = _clean_env(os.getenv("MAX_BOT_TOKEN"))
    raw_chat = _clean_env(os.getenv("MAX_CHANNEL_CHAT_ID"))
    if not token or not raw_chat:
        return None
    try:
        chat_id = int(raw_chat)
    except ValueError:
        return None
    if chat_id == 0:
        return None
    base = (os.getenv("MAX_API_BASE") or DEFAULT_API_BASE).strip().rstrip("/") or DEFAULT_API_BASE
    return MaxConfig(
        bot_token=token,
        channel_chat_id=chat_id,
        api_base=base,
        max_photos=_max_photos_limit(),
    )


def max_is_configured() -> bool:
    return load_max_config_from_env() is not None


def _http_client(*, timeout: float = 60.0) -> httpx.Client:
    return httpx.Client(timeout=timeout, follow_redirects=True, verify=http_verify())


def _extract_error_message(data: Any) -> str:
    if isinstance(data, dict):
        msg = data.get("message") or data.get("error") or data.get("detail")
        if msg:
            return str(msg)
        code = data.get("code")
        if code:
            return str(code)
    return "MAX API error"


def _api_request(
    cfg: MaxConfig,
    method: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
    timeout: float = 60.0,
) -> Any:
    url = f"{cfg.api_base}{path}"
    headers = {
        "Authorization": cfg.auth_header,
        "Content-Type": "application/json",
    }
    with _http_client(timeout=timeout) as client:
        resp = client.request(method, url, params=params, headers=headers, json=json_body)
    try:
        data = resp.json()
    except ValueError:
        data = resp.text
    if resp.status_code >= 400:
        raise MaxApiError(
            f"MAX {method} {path}: {_extract_error_message(data)} (HTTP {resp.status_code})",
            status_code=resp.status_code,
            raw=data,
        )
    if isinstance(data, dict) and data.get("success") is False:
        raise MaxApiError(
            f"MAX {method} {path}: {_extract_error_message(data)}",
            status_code=resp.status_code,
            raw=data,
        )
    return data


def mask_chat_id(chat_id: int) -> str:
    s = str(chat_id)
    if len(s) <= 4:
        return "***"
    return f"***{s[-4:]}"


def list_bot_chats(cfg: MaxConfig | None = None) -> list[dict[str, Any]]:
    """GET /chats — список чатов/каналов бота (deprecated с июня 2026)."""
    config = cfg or load_max_config_from_env()
    if config is None:
        raise MaxApiError("MAX не настроен: задайте MAX_BOT_TOKEN и MAX_CHANNEL_CHAT_ID")
    data = _api_request(config, "GET", "/chats")
    if isinstance(data, dict):
        chats = data.get("chats")
        if isinstance(chats, list):
            return [c for c in chats if isinstance(c, dict)]
    if isinstance(data, list):
        return [c for c in data if isinstance(c, dict)]
    return []


def _link_keyboard_attachment(listing_web_url: str) -> dict[str, Any]:
    return {
        "type": "inline_keyboard",
        "payload": {
            "buttons": [
                [
                    {
                        "type": "link",
                        "text": "Открыть на сайте",
                        "url": listing_web_url.strip(),
                    }
                ]
            ]
        },
    }


def _image_url_attachment(url: str) -> dict[str, Any]:
    return {"type": "image", "payload": {"url": url.strip()}}


def _image_token_attachment(token: str) -> dict[str, Any]:
    return {"type": "image", "payload": {"token": token}}


def _guess_image_content_type(file_path: Path) -> str:
    guessed, _ = mimetypes.guess_type(file_path.name)
    return guessed or "image/jpeg"


def _extract_image_upload_token(
    upload_resp: dict[str, Any],
    uploaded: dict[str, Any],
    upload_url: str,
) -> str | None:
    token = uploaded.get("token")
    if token:
        return str(token)

    photos = uploaded.get("photos")
    if isinstance(photos, dict):
        for value in photos.values():
            if isinstance(value, str) and value.strip():
                return value.strip()
            if isinstance(value, dict):
                nested = value.get("token")
                if nested:
                    return str(nested)

    token = upload_resp.get("token")
    if token:
        return str(token)

    parsed = urlparse(upload_url)
    query = parse_qs(parsed.query)
    for key in ("token", "photo_token", "file_token"):
        values = query.get(key)
        if values and values[0].strip():
            return values[0].strip()
    return None


def _upload_image_file(cfg: MaxConfig, file_path: Path) -> str:
    upload_resp = _api_request(
        cfg,
        "POST",
        "/uploads",
        params={"type": "image"},
        timeout=90.0,
    )
    if not isinstance(upload_resp, dict) or not upload_resp.get("url"):
        raise MaxApiError("POST /uploads: нет url", raw=upload_resp)
    upload_url = str(upload_resp["url"])
    content_type = _guess_image_content_type(file_path)
    with file_path.open("rb") as fh:
        with _http_client(timeout=120.0) as client:
            resp = client.post(
                upload_url,
                headers={"Authorization": cfg.auth_header},
                files={"data": (file_path.name, fh, content_type)},
            )
        resp.raise_for_status()
        try:
            uploaded = resp.json()
        except ValueError as exc:
            raise MaxApiError("upload: ответ не JSON", raw=resp.text) from exc
    if not isinstance(uploaded, dict):
        raise MaxApiError("upload: неожиданный ответ", raw=uploaded)
    token = _extract_image_upload_token(upload_resp, uploaded, upload_url)
    if not token:
        raise MaxApiError("upload: нет token", raw={"upload": upload_resp, "uploaded": uploaded})
    return token


def upload_image_from_url(cfg: MaxConfig, url: str) -> str:
    tmp: Path | None = None
    try:
        tmp = download_photo_to_temp(url)
        return _upload_image_file(cfg, tmp)
    finally:
        if tmp is not None:
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass


def _parse_message_id(message: dict[str, Any]) -> int | None:
    body = message.get("body")
    if isinstance(body, dict):
        for key in ("mid", "id", "message_id"):
            raw = body.get(key)
            if raw is not None:
                try:
                    return int(raw)
                except (TypeError, ValueError):
                    pass
    ts = message.get("timestamp")
    if ts is not None:
        try:
            return int(ts)
        except (TypeError, ValueError):
            pass
    return None


def _is_attachment_not_ready(exc: MaxApiError) -> bool:
    msg = str(exc).lower()
    raw = exc.raw
    if isinstance(raw, dict):
        code = str(raw.get("code") or "").lower()
        detail = str(raw.get("message") or raw.get("detail") or "").lower()
        if "attachment.not.ready" in code or "not.processed" in detail:
            return True
    return "attachment.not.ready" in msg or "not.processed" in msg


def _send_message(
    cfg: MaxConfig,
    *,
    text: str,
    attachments: list[dict[str, Any]],
) -> MaxChannelPostResult:
    body: dict[str, Any] = {
        "text": (text or "").strip(),
        "notify": True,
    }
    if attachments:
        body["attachments"] = attachments
    if not body["text"] and not attachments:
        raise MaxApiError("Нужен текст или вложения для поста в MAX")

    data = _api_request(
        cfg,
        "POST",
        "/messages",
        params={"chat_id": cfg.channel_chat_id},
        json_body=body,
        timeout=90.0,
    )
    if not isinstance(data, dict):
        raise MaxApiError("POST /messages: неожиданный ответ", raw=data)
    message = data.get("message")
    if not isinstance(message, dict):
        raise MaxApiError("POST /messages: нет message в ответе", raw=data)
    post_url = message.get("url")
    if post_url is not None:
        post_url = str(post_url).strip() or None
    return MaxChannelPostResult(
        message_id=_parse_message_id(message),
        post_url=post_url,
        raw_message=message,
    )


def _send_message_with_retry(
    cfg: MaxConfig,
    *,
    text: str,
    attachments: list[dict[str, Any]],
) -> MaxChannelPostResult:
    delays = (0, 2, 4, 8)
    last_exc: MaxApiError | None = None
    for delay in delays:
        if delay:
            time.sleep(delay)
        try:
            return _send_message(cfg, text=text, attachments=attachments)
        except MaxApiError as exc:
            if _is_attachment_not_ready(exc):
                last_exc = exc
                log.warning("MAX: вложение ещё обрабатывается, повтор через %ss: %s", delay, exc)
                continue
            raise
    if last_exc is not None:
        raise last_exc
    raise MaxApiError("MAX: не удалось отправить сообщение")


def _upload_image_tokens(cfg: MaxConfig, urls: list[str]) -> list[str]:
    if not urls:
        return []
    workers = min(3, len(urls))
    if workers == 1:
        return [upload_image_from_url(cfg, urls[0])]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(lambda url: upload_image_from_url(cfg, url), urls))


def _should_retry_with_upload(exc: MaxApiError) -> bool:
    msg = str(exc).lower()
    return any(
        token in msg
        for token in (
            "url",
            "image",
            "attachment",
            "forbidden",
            "not found",
            "download",
        )
    )


def send_channel_message(
    cfg: MaxConfig,
    *,
    text: str,
    image_urls: list[str],
    listing_web_url: str | None = None,
) -> MaxChannelPostResult:
    urls = [u for u in image_urls if (u or "").strip()][: cfg.max_photos]
    attachments: list[dict[str, Any]] = [_image_url_attachment(u) for u in urls]
    link = (listing_web_url or "").strip()
    if link:
        attachments.append(_link_keyboard_attachment(link))

    try:
        return _send_message_with_retry(cfg, text=text, attachments=attachments)
    except MaxApiError as exc:
        if not urls or not _should_retry_with_upload(exc):
            raise
        log.warning("MAX: повтор с upload вместо URL: %s", exc)

    token_attachments = [_image_token_attachment(token) for token in _upload_image_tokens(cfg, urls)]
    if link:
        token_attachments.append(_link_keyboard_attachment(link))
    return _send_message_with_retry(cfg, text=text, attachments=token_attachments)


def publish_listing_to_channel(
    *,
    message: str,
    photo_urls: list[str],
    listing_web_url: str | None = None,
    cfg: MaxConfig | None = None,
) -> MaxChannelPostResult:
    config = cfg or load_max_config_from_env()
    if config is None:
        raise MaxApiError(
            "MAX не настроен: задайте MAX_BOT_TOKEN и MAX_CHANNEL_CHAT_ID "
            "(см. deploy/MAX_SETUP_RU.md)."
        )
    link = (listing_web_url or "").strip() or None
    return send_channel_message(
        config,
        text=message,
        image_urls=photo_urls,
        listing_web_url=link,
    )
