"""Фильтры списка объявлений: КПП, пробег, ориентир цены в ₽."""

from __future__ import annotations

from sqlalchemy import or_

from .models import Car

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


_FUEL_TYPE_PATTERNS: dict[str, list[str]] = {
    "gasoline": ["%бензин%", "%gasoline%", "%petrol%", "%汽油%"],
    "hybrid": ["%гибрид%", "%hybrid%", "%phev%", "%hev%", "%增程%"],
    "electric": ["%электро%", "%electric%", "%ev%", "%纯电%", "%bev%"],
}


def apply_fuel_type_filter(stmt, fuel_type: str | None):
    if not fuel_type:
        return stmt
    patterns = _FUEL_TYPE_PATTERNS.get(fuel_type.strip().lower())
    if not patterns:
        return stmt
    return stmt.where(or_(*[Car.fuel_type.ilike(p) for p in patterns]))


def matches_turnkey_rub_bounds(
    estimated_total_rub: float | None,
    rub_from: float | None,
    rub_to: float | None,
) -> bool:
    """Проверка цены «под ключ» (₽) против границ фильтра каталога."""
    if estimated_total_rub is None:
        return False
    total = float(estimated_total_rub)
    if rub_from is not None and total < float(rub_from):
        return False
    if rub_to is not None and total > float(rub_to):
        return False
    return True
