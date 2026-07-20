#!/usr/bin/env python3
"""
Spike / ручная проверка VK wall.post.

Требует в окружении:
  VK_GROUP_ID=123456789
  VK_USER_ACCESS_TOKEN=...   # user token (не community), scopes: photos,wall,offline
  VK_API_VERSION=5.199       # опционально

Примеры:
  PYTHONPATH=. python -m scripts.test_vk_wall_post
  PYTHONPATH=. python -m scripts.test_vk_wall_post --message "Тест" --photo https://example.com/a.jpg
"""

from __future__ import annotations

import argparse
import sys

from app.vk_client import VkApiError, load_vk_config_from_env, publish_listing_to_group, wall_post


def main() -> int:
    parser = argparse.ArgumentParser(description="Тест публикации на стену группы VK")
    parser.add_argument("--message", default="Тест публикации avtovozom → VK")
    parser.add_argument("--photo", action="append", default=[], help="URL фото (можно несколько)")
    parser.add_argument("--link", default=None, help="Ссылка на карточку сайта")
    args = parser.parse_args()

    cfg = load_vk_config_from_env()
    if cfg is None:
        print(
            "Задайте VK_GROUP_ID и VK_USER_ACCESS_TOKEN "
            "(user access token админа/редактора группы).",
            file=sys.stderr,
        )
        return 2

    try:
        if args.photo:
            result = publish_listing_to_group(
                message=args.message,
                photo_urls=list(args.photo),
                listing_web_url=args.link,
                cfg=cfg,
            )
        else:
            result = wall_post(cfg, message=args.message, link_url=args.link)
    except VkApiError as e:
        print(f"VK error: {e} (code={e.error_code})", file=sys.stderr)
        return 1

    print(f"OK post_id={result.post_id} url={result.wall_url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
