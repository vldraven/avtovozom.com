"""
Статический справочник поколений (JSON) + привязка Car.year к поколению.

Источники годов указаны в data/generations_reference.json (Wikipedia EN, обзоры модельных рядов).

Запуск вручную: из каталога backend:
  python -m app.apply_generations_reference

Вызывается также из seed_initial_data после базового seed справочника марок/моделей.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from .models import Car, CarBrand, CarGeneration, CarModel

log = logging.getLogger(__name__)

_DATA_PATH = Path(__file__).resolve().parent / "data" / "generations_reference.json"


def _pick_generation_for_year(year: int | None, rows: list[CarGeneration]) -> CarGeneration | None:
    if not rows:
        return None
    rows_sorted = sorted(rows, key=lambda g: ((g.year_from or 0), g.slug or ""))
    if year is None:
        return rows_sorted[-1]
    best: CarGeneration | None = None
    for g in rows_sorted:
        yf = g.year_from if g.year_from is not None else 0
        yt = g.year_to if g.year_to is not None else 9999
        if yf <= year <= yt:
            best = g
    if best is not None:
        return best
    before = [g for g in rows_sorted if (g.year_from or 0) <= year]
    if before:
        return before[-1]
    return rows_sorted[0]


def _find_model_ids(db: Session, brand_name: str, model_names: list[str]) -> list[int]:
    brand = db.execute(select(CarBrand).where(CarBrand.name == brand_name)).scalar_one_or_none()
    if not brand:
        return []
    out: list[int] = []
    for mn in model_names:
        m = db.execute(
            select(CarModel).where(
                CarModel.brand_id == brand.id,
                CarModel.name == mn,
            )
        ).scalar_one_or_none()
        if m:
            out.append(m.id)
    return out


def _apply_one_model(
    db: Session, model_id: int, generations_spec: list[dict]
) -> None:
    db.execute(update(Car).where(Car.model_id == model_id).values(generation_id=None))
    db.execute(delete(CarGeneration).where(CarGeneration.model_id == model_id))
    db.flush()

    new_rows: list[CarGeneration] = []
    for g in generations_spec:
        slug = (g.get("slug") or "").strip() or None
        if not slug:
            raise ValueError(f"generation slug required for {g.get('name')}")
        yf = g.get("year_from")
        yt = g.get("year_to")
        row = CarGeneration(
            model_id=model_id,
            name=str(g["name"]).strip(),
            slug=slug,
            year_from=int(yf) if yf is not None else None,
            year_to=int(yt) if yt is not None else None,
        )
        db.add(row)
        new_rows.append(row)
    db.flush()

    cars = (
        db.execute(select(Car).where(Car.model_id == model_id, Car.is_active.is_(True)))
        .scalars()
        .all()
    )
    for car in cars:
        gen = _pick_generation_for_year(car.year, new_rows)
        if gen is not None:
            car.generation_id = gen.id


def apply_generations_reference_file(db: Session) -> dict:
    """
    Для каждой записи JSON находит строки CarModel и полностью заменяет поколения + перепривязывает авто.
    """
    stats = {"entries": 0, "model_rows_updated": 0, "skipped_no_file": False}
    if not _DATA_PATH.is_file():
        stats["skipped_no_file"] = True
        return stats

    raw = json.loads(_DATA_PATH.read_text(encoding="utf-8"))
    entries = raw.get("entries") or []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        brand = entry.get("brand")
        models = entry.get("models") or []
        gens = entry.get("generations") or []
        if not brand or not models or not gens:
            continue
        stats["entries"] += 1
        mids = _find_model_ids(db, str(brand), [str(m) for m in models])
        for mid in mids:
            try:
                with db.begin_nested():
                    _apply_one_model(db, mid, gens)
                stats["model_rows_updated"] += 1
                log.info("generations reference: model_id=%s (%s) updated", mid, brand)
            except Exception as e:
                log.warning("generations reference: model_id=%s skipped: %s", mid, e)
    db.commit()
    return stats


def main() -> None:
    from .db import SessionLocal

    logging.basicConfig(level=logging.INFO)
    db = SessionLocal()
    try:
        s = apply_generations_reference_file(db)
        print(s)
    finally:
        db.close()


if __name__ == "__main__":
    main()
