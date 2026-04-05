"""Скачивание фото объявлений на локальный диск и пути для /media."""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import httpx

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "Referer": "https://www.che168.com/",
    "Accept-Language": "zh-CN,zh;q=0.9",
}


def media_root() -> Path:
    return Path(os.getenv("MEDIA_ROOT", "/app/media"))


def _looks_like_image(data: bytes) -> bool:
    if len(data) < 12:
        return False
    if data[:3] == b"\xff\xd8\xff":
        return True
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return True
    if data[:4] == b"RIFF" and len(data) >= 12 and data[8:12] == b"WEBP":
        return True
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return True
    return False


def download_car_photos(car_id: int, urls: list[str], max_count: int = 12) -> list[str]:
    """
    Сохраняет файлы в MEDIA_ROOT/cars/{car_id}/ и возвращает относительные URL (/media/...).
    При полном провале скачивания возвращает исходные http(s) ссылки.
    """
    if not urls:
        return []
    root = media_root()
    car_dir = root / "cars" / str(car_id)
    car_dir.mkdir(parents=True, exist_ok=True)
    saved: list[str] = []
    with httpx.Client(timeout=45.0, follow_redirects=True, headers=_HEADERS) as client:
        for i, url in enumerate(urls[:max_count]):
            if not url or not url.startswith("http"):
                continue
            try:
                r = client.get(url)
                r.raise_for_status()
                data = r.content
                if not _looks_like_image(data):
                    continue
                if data[:8] == b"\x89PNG\r\n\x1a\n":
                    ext = ".png"
                elif len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
                    ext = ".webp"
                else:
                    ext = ".jpg"
                fname = f"{i}{ext}"
                path = car_dir / fname
                path.write_bytes(data)
                saved.append(f"/media/cars/{car_id}/{fname}")
            except Exception:
                continue
    if saved:
        return saved
    return [u for u in urls[:max_count] if u.startswith("http")]


def save_uploaded_car_photos(
    car_id: int, image_blobs: list[bytes], max_count: int = 15
) -> list[str]:
    """
    Сохраняет загруженные байты в MEDIA_ROOT/cars/{car_id}/, возвращает /media/... пути.
    """
    if not image_blobs:
        return []
    root = media_root()
    car_dir = root / "cars" / str(car_id)
    car_dir.mkdir(parents=True, exist_ok=True)
    saved: list[str] = []
    for i, data in enumerate(image_blobs[:max_count]):
        if not _looks_like_image(data):
            continue
        if data[:8] == b"\x89PNG\r\n\x1a\n":
            ext = ".png"
        elif len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            ext = ".webp"
        else:
            ext = ".jpg"
        fname = f"up_{i}{ext}"
        path = car_dir / fname
        path.write_bytes(data)
        saved.append(f"/media/cars/{car_id}/{fname}")
    return saved


_CHAT_ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024
_CHAT_ALLOWED_EXT = frozenset(
    {
        ".pdf",
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".gif",
        ".doc",
        ".docx",
        ".xls",
        ".xlsx",
        ".txt",
        ".zip",
        ".heic",
    }
)


def save_chat_attachment(chat_id: int, data: bytes, original_name: str) -> tuple[str, str]:
    """
    Сохраняет вложение в MEDIA_ROOT/chat/{chat_id}/, возвращает (относительный URL /media/..., имя для отображения).
    """
    if len(data) > _CHAT_ATTACHMENT_MAX_BYTES:
        raise ValueError("Файл слишком большой (максимум 15 МБ).")
    raw = (original_name or "file").replace("\\", "/").split("/")[-1].strip() or "file"
    ext = Path(raw).suffix.lower()
    if ext not in _CHAT_ALLOWED_EXT:
        ext = ".bin"
    fname = f"{uuid.uuid4().hex}{ext}"
    root = media_root() / "chat" / str(chat_id)
    root.mkdir(parents=True, exist_ok=True)
    path = root / fname
    path.write_bytes(data)
    return f"/media/chat/{chat_id}/{fname}", raw[:200]
