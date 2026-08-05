"""
Повторный fetch комплектаций Autohome для всех car_trims с autohome_spec_id.

Нужен после фикса _item_value (привод в sublist.subvalue): старый source_spec_json
уже сохранён с «—», rebuild из source не поможет.

Запуск из каталога backend:
  PYTHONPATH=. python -m scripts.refresh_trim_drive
  PYTHONPATH=. python -m scripts.refresh_trim_drive --limit 5
  PYTHONPATH=. python -m scripts.refresh_trim_drive --sleep 0.5

В Docker:
  docker compose exec -T backend python -m scripts.refresh_trim_drive
"""

from __future__ import annotations

import argparse
import json
import os
import sys

if __name__ == "__main__" and not os.environ.get("PYTHONPATH"):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db import SessionLocal  # noqa: E402
from app.trim_catalog import refresh_all_trims_from_autohome  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Re-fetch Autohome specs for car_trims")
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Обновить не больше N комплектаций (для прогона)",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=0.35,
        help="Пауза между запросами к Autohome (сек)",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        summary = refresh_all_trims_from_autohome(
            db,
            limit=args.limit,
            sleep_s=max(0.0, args.sleep),
        )
    finally:
        db.close()

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if summary.get("updated", 0) == 0 and summary.get("scanned", 0) > 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
