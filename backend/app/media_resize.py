"""Уменьшение локальных /media/* с дисковым кэшем (карточки/thumbs без 1024px оригинала)."""

from __future__ import annotations

import io
import os
from pathlib import Path

# Белый список ширин — защита от произвольного resize-abuse.
ALLOWED_WIDTHS = frozenset({160, 320, 480, 640, 960})

# JPEG quality: баланс размер/артефакты для карточек каталога.
_JPEG_QUALITY = 78
_CACHE_DIRNAME = ".cache"


def media_root() -> Path:
    return Path(os.getenv("MEDIA_ROOT", "/app/media"))


def resolve_local_media_path(storage_url: str) -> Path | None:
    """
    /media/cars/1/0.jpg → абсолютный Path под MEDIA_ROOT.
    Внешние URL и path traversal → None.
    """
    raw = (storage_url or "").strip()
    if not raw.startswith("/media/"):
        return None
    rel = raw[len("/media/") :].lstrip("/")
    if not rel or rel.startswith(".") or ".." in rel.split("/"):
        return None
    root = media_root().resolve()
    path = (root / Path(rel)).resolve()
    try:
        path.relative_to(root)
    except ValueError:
        return None
    # Не отдаём и не ресайзим сам кэш как «оригинал».
    if _CACHE_DIRNAME in path.parts:
        return None
    if not path.is_file():
        return None
    return path


def cache_path_for(src: Path, width: int) -> Path:
    root = media_root().resolve()
    rel = src.resolve().relative_to(root)
    # Всегда .jpg в кэше — единый content-type для браузера.
    return root / _CACHE_DIRNAME / f"w{int(width)}" / rel.with_suffix(".jpg")


def resize_local_image(src: Path, width: int) -> tuple[bytes, str]:
    """
    Возвращает (jpeg_bytes, media_type). Если оригинал уже не шире width — не апскейлит,
    только перекодирует в JPEG для единого кэша.
    Пишет результат в disk cache.
    """
    from PIL import Image, ImageOps

    if width not in ALLOWED_WIDTHS:
        raise ValueError(f"width must be one of {sorted(ALLOWED_WIDTHS)}")

    cached = cache_path_for(src, width)
    if cached.is_file() and cached.stat().st_mtime >= src.stat().st_mtime:
        return cached.read_bytes(), "image/jpeg"

    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        elif im.mode == "L":
            im = im.convert("RGB")
        w, h = im.size
        if w > width:
            new_h = max(1, round(h * (width / w)))
            im = im.resize((width, new_h), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=_JPEG_QUALITY, optimize=True, progressive=True)
        data = buf.getvalue()

    cached.parent.mkdir(parents=True, exist_ok=True)
    tmp = cached.with_suffix(cached.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(cached)
    return data, "image/jpeg"
