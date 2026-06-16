#!/usr/bin/env python3
"""Локальный прогон mobile Che168: python3 scripts/test_mobile_che168_parse.py '<url>'"""

from __future__ import annotations

import json
import sys

from app.che168_parser import (
    _detail_fetch_urls,
    _playwright_fetch_urls,
    normalize_import_detail_url,
    parse_che168_detail,
    source_listing_id_from_url,
)

DEFAULT_URL = (
    "https://m.che168.com/cardetail/index?infoid=58661738"
    "&adfromid=30363497&pvareaid=108948"
)


def main() -> None:
    url = (sys.argv[1] if len(sys.argv) > 1 else DEFAULT_URL).strip()
    print("URL:", url)
    print("source_listing_id:", source_listing_id_from_url(url))
    print("normalized:", normalize_import_detail_url(url))
    print("http_fetch_urls:", _detail_fetch_urls(url))
    print("pw_fetch_urls:", _playwright_fetch_urls(url))
    print("parsing…")
    parsed = parse_che168_detail(url)
    print(
        json.dumps(
            {
                "source_listing_id": parsed.source_listing_id,
                "title": parsed.title,
                "price_cny": parsed.price_cny,
                "mileage_km": parsed.mileage_km,
                "year": parsed.year,
                "autohome_spec_id": parsed.autohome_spec_id,
                "photos": len(parsed.photos or []),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
