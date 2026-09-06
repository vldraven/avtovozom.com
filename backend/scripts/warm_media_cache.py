#!/usr/bin/env python3
"""
Прогрев дискового кэша /media-img для уже лежащих на диске фото.

Запуск на сервере (в контейнере api или с MEDIA_ROOT):
  python -m scripts.warm_media_cache
  python -m scripts.warm_media_cache --widths 160,320,480,640
  python -m scripts.warm_media_cache --limit 500

Полезно один раз после деплоя оптимизаций картинок, пока каталог ещё «холодный».
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# backend/scripts → backend на sys.path
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from app.media_resize import ALLOWED_WIDTHS, WARM_WIDTHS, warm_media_variants  # noqa: E402


def _iter_media_urls(media_root: Path, limit: int | None) -> list[str]:
    cars = media_root / "cars"
    brands = media_root / "brands"
    urls: list[str] = []
    for base, prefix in ((cars, "cars"), (brands, "brands")):
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file():
                continue
            if path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
                continue
            if ".cache" in path.parts:
                continue
            rel = path.relative_to(media_root).as_posix()
            urls.append(f"/media/{rel}")
            if limit is not None and len(urls) >= limit:
                return urls
    return urls


def main() -> int:
    parser = argparse.ArgumentParser(description="Warm /media-img disk cache")
    parser.add_argument(
        "--widths",
        default=",".join(str(w) for w in WARM_WIDTHS),
        help=f"Comma-separated widths (allowed: {sorted(ALLOWED_WIDTHS)})",
    )
    parser.add_argument("--limit", type=int, default=None, help="Max files to process")
    args = parser.parse_args()

    widths = tuple(int(x.strip()) for x in args.widths.split(",") if x.strip())
    bad = [w for w in widths if w not in ALLOWED_WIDTHS]
    if bad:
        print(f"Unsupported widths: {bad}; allowed {sorted(ALLOWED_WIDTHS)}", file=sys.stderr)
        return 2

    media_root = Path(os.getenv("MEDIA_ROOT", "/app/media"))
    urls = _iter_media_urls(media_root, args.limit)
    print(f"Warming {len(urls)} files under {media_root} widths={widths}")
    warm_media_variants(urls, widths=widths)
    print("Done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
