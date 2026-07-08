"""Фильтры списка объявлений: КПП, пробег, ориентир цены в ₽."""

from __future__ import annotations

import os

from sqlalchemy import or_

from .models import Car
from .schemas import CbrSnapshot

_TRANSMISSION_PATTERNS: dict[str, list[str]] = {
    "at": ["%AT%", "%автомат%", "%自动%"],
    "amt": ["%AMT%", "%робот%", "%双离合%"],
    "cvt": ["%CVT%", "%вариатор%", "%无级%"],
    "mt": ["%MT%", "%механ%", "%手动%", "%Manual%"],
    "auto": [
        "%AT%",
        "%AMT%",
        "%CVT%",
        "%автомат%",
        "%робот%",
        "%вариатор%",
        "%自动%",
        "%双离合%",
        "%无级%",
    ],
    "manual": ["%MT%", "%механ%", "%手动%", "%Manual%"],
}


def apply_transmission_filter(stmt, transmission: str | None):
    if not transmission:
        return stmt
    patterns = _TRANSMISSION_PATTERNS.get(transmission.strip().lower())
    if not patterns:
        return stmt
    return stmt.where(or_(*[Car.transmission.ilike(p) for p in patterns]))


def cny_bounds_from_rub_bounds(
    rub_from: float | None,
    rub_to: float | None,
    snap: CbrSnapshot | None,
) -> tuple[float | None, float | None]:
    """Грубый перевод ₽ → CNY для фильтра по ориентировочной цене под ключ."""
    if snap is None:
        return None, None
    mult = float(os.getenv("PRICE_FILTER_RUB_MULTIPLIER", "2.2"))
    denom = float(snap.rub_per_cny) * mult
    if denom <= 0:
        return None, None
    cny_from = float(rub_from) / denom if rub_from is not None else None
    cny_to = float(rub_to) / denom if rub_to is not None else None
    return cny_from, cny_to
