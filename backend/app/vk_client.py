"""Клиент VK API: загрузка фото на стену сообщества и wall.post."""

from __future__ import annotations

import logging
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

log = logging.getLogger(__name__)

VK_API = "https://api.vk.com/method"
DEFAULT_API_VERSION = "5.199"
MAX_WALL_PHOTOS = 10


class VkApiError(RuntimeError):
    def __init__(self, message: str, *, error_code: int | None = None, raw: Any = None):
        super().__init__(message)
        self.error_code = error_code
        self.raw = raw


@dataclass
class VkConfig:
    group_id: int
    user_access_token: str
    api_version: str = DEFAULT_API_VERSION


@dataclass
class VkWallPostResult:
    post_id: int
    owner_id: int
    wall_url: str


def load_vk_config_from_env() -> VkConfig | None:
    raw_gid = (os.getenv("VK_GROUP_ID") or "").strip()
    token = (os.getenv("VK_USER_ACCESS_TOKEN") or "").strip()
    if not raw_gid or not token:
        return None
    try:
        group_id = int(raw_gid)
    except ValueError:
        return None
    if group_id <= 0:
        return None
    version = (os.getenv("VK_API_VERSION") or DEFAULT_API_VERSION).strip() or DEFAULT_API_VERSION
    return VkConfig(group_id=group_id, user_access_token=token, api_version=version)


def vk_is_configured() -> bool:
    return load_vk_config_from_env() is not None


def _api_call(
    method: str,
    params: dict[str, Any],
    *,
    token: str,
    api_version: str,
    timeout: float = 45.0,
) -> Any:
    payload = {**params, "access_token": token, "v": api_version}
    with httpx.Client(timeout=timeout) as client:
        resp = client.post(f"{VK_API}/{method}", data=payload)
        resp.raise_for_status()
        data = resp.json()
    if not isinstance(data, dict):
        raise VkApiError(f"VK {method}: неожиданный ответ", raw=data)
    if "error" in data:
        err = data["error"] or {}
        code = err.get("error_code")
        msg = err.get("error_msg") or "VK API error"
        raise VkApiError(f"VK {method}: {msg}", error_code=int(code) if code is not None else None, raw=err)
    return data.get("response")


def _guess_suffix(url: str, content_type: str | None) -> str:
    path = urlparse(url).path.lower()
    for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        if path.endswith(ext):
            return ext if ext != ".jpeg" else ".jpg"
    ct = (content_type or "").lower()
    if "png" in ct:
        return ".png"
    if "webp" in ct:
        return ".webp"
    if "gif" in ct:
        return ".gif"
    return ".jpg"


def download_photo_to_temp(url: str, *, timeout: float = 60.0) -> Path:
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        resp = client.get(url)
        resp.raise_for_status()
        suffix = _guess_suffix(url, resp.headers.get("content-type"))
        fd, name = tempfile.mkstemp(prefix="vk_photo_", suffix=suffix)
        os.close(fd)
        path = Path(name)
        path.write_bytes(resp.content)
        return path


def get_wall_upload_server(cfg: VkConfig) -> str:
    resp = _api_call(
        "photos.getWallUploadServer",
        {"group_id": cfg.group_id},
        token=cfg.user_access_token,
        api_version=cfg.api_version,
    )
    if not isinstance(resp, dict) or not resp.get("upload_url"):
        raise VkApiError("photos.getWallUploadServer: нет upload_url", raw=resp)
    return str(resp["upload_url"])


def upload_photo_file(upload_url: str, file_path: Path, *, timeout: float = 90.0) -> dict[str, Any]:
    with httpx.Client(timeout=timeout) as client:
        with file_path.open("rb") as fh:
            resp = client.post(upload_url, files={"photo": (file_path.name, fh, "image/jpeg")})
        resp.raise_for_status()
        data = resp.json()
    if not isinstance(data, dict):
        raise VkApiError("upload server: неожиданный ответ", raw=data)
    if not data.get("photo") or data.get("photo") in ("[]", ""):
        raise VkApiError("upload server: пустое поле photo (файл отклонён)", raw=data)
    return data


def save_wall_photo(cfg: VkConfig, upload: dict[str, Any]) -> str:
    """Вернуть attachment вида photo{owner_id}_{id}."""
    resp = _api_call(
        "photos.saveWallPhoto",
        {
            "group_id": cfg.group_id,
            "photo": upload.get("photo"),
            "server": upload.get("server"),
            "hash": upload.get("hash"),
        },
        token=cfg.user_access_token,
        api_version=cfg.api_version,
    )
    if not isinstance(resp, list) or not resp:
        raise VkApiError("photos.saveWallPhoto: пустой ответ", raw=resp)
    item = resp[0]
    owner_id = item.get("owner_id")
    media_id = item.get("id")
    if owner_id is None or media_id is None:
        raise VkApiError("photos.saveWallPhoto: нет owner_id/id", raw=item)
    return f"photo{owner_id}_{media_id}"


def upload_wall_photos_from_urls(cfg: VkConfig, photo_urls: list[str]) -> list[str]:
    """Скачать URL и загрузить на стену; вернуть список attachments."""
    urls = [u for u in photo_urls if (u or "").strip()][:MAX_WALL_PHOTOS]
    if not urls:
        return []
    upload_url = get_wall_upload_server(cfg)
    attachments: list[str] = []
    for url in urls:
        tmp: Path | None = None
        try:
            tmp = download_photo_to_temp(url)
            uploaded = upload_photo_file(upload_url, tmp)
            att = save_wall_photo(cfg, uploaded)
            attachments.append(att)
        except Exception as exc:
            log.warning("VK photo upload failed url=%s: %s", url[:120], exc)
            raise VkApiError(f"Не удалось загрузить фото в VK: {exc}") from exc
        finally:
            if tmp is not None:
                try:
                    tmp.unlink(missing_ok=True)
                except OSError:
                    pass
    return attachments


def wall_post(
    cfg: VkConfig,
    *,
    message: str,
    attachments: list[str] | None = None,
    link_url: str | None = None,
) -> VkWallPostResult:
    owner_id = -int(cfg.group_id)
    atts = list(attachments or [])
    if link_url and str(link_url).strip():
        atts.append(str(link_url).strip())
    # VK: не более 10 медиа; ссылка тоже вложения — оставляем до 10 всего
    atts = atts[:10]
    params: dict[str, Any] = {
        "owner_id": owner_id,
        "from_group": 1,
        "message": (message or "").strip(),
    }
    if atts:
        params["attachments"] = ",".join(atts)
    if not params["message"] and not atts:
        raise VkApiError("Нужен текст или вложения для wall.post")

    resp = _api_call(
        "wall.post",
        params,
        token=cfg.user_access_token,
        api_version=cfg.api_version,
        timeout=60.0,
    )
    if not isinstance(resp, dict) or resp.get("post_id") is None:
        raise VkApiError("wall.post: нет post_id", raw=resp)
    post_id = int(resp["post_id"])
    wall_url = f"https://vk.com/wall{owner_id}_{post_id}"
    return VkWallPostResult(post_id=post_id, owner_id=owner_id, wall_url=wall_url)


def publish_listing_to_group(
    *,
    message: str,
    photo_urls: list[str],
    listing_web_url: str | None = None,
    cfg: VkConfig | None = None,
) -> VkWallPostResult:
    config = cfg or load_vk_config_from_env()
    if config is None:
        raise VkApiError(
            "VK не настроен: задайте VK_GROUP_ID и VK_USER_ACCESS_TOKEN "
            "(user token админа группы со scopes photos,wall,offline)."
        )
    link = (listing_web_url or "").strip() or None
    # Оставляем слот под ссылку на карточку (лимит VK — 10 вложений)
    photo_budget = MAX_WALL_PHOTOS - (1 if link else 0)
    attachments = upload_wall_photos_from_urls(config, photo_urls[: max(0, photo_budget)])
    return wall_post(
        config,
        message=message,
        attachments=attachments,
        link_url=link,
    )
