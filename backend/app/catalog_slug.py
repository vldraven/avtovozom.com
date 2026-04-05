"""Стабильные URL-фрагменты для марок и моделей (каталог, хлебные крошки)."""

from __future__ import annotations

import re
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import CarBrand, CarModel

_RU_LOWER = str.maketrans(
    "абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
    "abvgdeejzijklmnoprstufhchshsch_y_eua",
)
_RU_UPPER = str.maketrans(
    "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ",
    "ABVGDEEJZIJKLMNOPRSTUFHCHSHSCH_Y_EUA",
)


def slugify_label(raw: str) -> str:
    if not raw or not str(raw).strip():
        return "x"
    s = str(raw).strip().lower()
    s = s.translate(_RU_LOWER).translate(_RU_UPPER)
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "x"


def _assign_unique_slug_map(rows: list[tuple[int, str]]) -> dict[int, str]:
    """rows: (id, display_name); порядок по id для стабильности при коллизиях."""
    rows = sorted(rows, key=lambda x: x[0])
    used: set[str] = set()
    out: dict[int, str] = {}
    for oid, name in rows:
        base = slugify_label(name)
        cand = base
        n = 0
        while cand in used:
            n += 1
            cand = f"{base}-{n}"
        used.add(cand)
        out[oid] = cand
    return out


def build_catalog_slug_maps(db: Session) -> tuple[dict[int, str], dict[tuple[int, int], str]]:
    """Марка id → slug; (brand_id, model_id) → slug модели в рамках бренда."""
    brand_rows = db.execute(select(CarBrand.id, CarBrand.name)).all()
    bmap = _assign_unique_slug_map([(r[0], r[1]) for r in brand_rows])

    model_rows = db.execute(
        select(CarModel.brand_id, CarModel.id, CarModel.name).order_by(
            CarModel.brand_id, CarModel.id
        )
    ).all()
    by_brand: dict[int, list[tuple[int, str]]] = defaultdict(list)
    for bid, mid, name in model_rows:
        by_brand[bid].append((mid, name))
    mmap: dict[tuple[int, int], str] = {}
    for bid, rows in by_brand.items():
        m = _assign_unique_slug_map(rows)
        for mid, slug in m.items():
            mmap[(bid, mid)] = slug
    return bmap, mmap


def slugs_for_car(
    car,
    bmap: dict[int, str],
    mmap: dict[tuple[int, int], str],
) -> tuple[str, str]:
    bid = car.brand_id
    mid = car.model_id
    bslug = bmap.get(bid)
    mslug = mmap.get((bid, mid))
    if bslug is None and car.brand is not None:
        bslug = slugify_label(car.brand.name)
    elif bslug is None:
        bslug = f"brand-{bid}"
    if mslug is None and car.model is not None:
        mslug = slugify_label(car.model.name)
    elif mslug is None:
        mslug = f"model-{mid}"
    return bslug, mslug
