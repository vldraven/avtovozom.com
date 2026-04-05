"""
Русские заголовок и нейтральное описание объявления без данных продавца.
"""

from __future__ import annotations

import re


def title_looks_corrupted(s: str | None) -> bool:
    if not s or not str(s).strip():
        return True
    t = str(s).strip()
    if "\ufffd" in t:
        return True
    # Типичные артефакты при порче UTF-8 / неверном переводе
    bad_marks = ("姹", "氹", "涔", "瀹", "浜", "枞", "寤", "哄")
    hits = sum(1 for c in bad_marks if c in t)
    if hits >= 2:
        return True
    # Очень короткий повторяющийся мусор
    if len(t) <= 40 and len(set(t)) <= 6:
        return True
    return False


def russian_listing_title(brand: str, model: str, year: int) -> str:
    """Краткий заголовок на русском: марка, модель, год."""
    b = (brand or "").strip()
    m = (model or "").strip()
    y = int(year) if year else 0
    if b and m and y:
        return f"{b} {m}, {y} г.в."
    if b and m:
        return f"{b} {m}"
    return b or m or "Автомобиль"


def basic_neutral_description_ru(
    brand: str,
    model: str,
    year: int,
    mileage_km: int | None,
    engine_volume_cc: int | None,
    horsepower: int | None,
    fuel_type: str | None,
    transmission: str | None,
    location_city: str | None,
) -> str:
    """
    Базовое описание только по характеристикам, без продавца и контактов.
    """
    b = (brand or "").strip()
    m = (model or "").strip()
    y = int(year) if year else 0
    parts: list[str] = [
        f"Легковой автомобиль {b} {m} {y} года выпуска."
    ]
    if mileage_km is not None and mileage_km >= 0:
        parts.append(f"Заявленный пробег {mileage_km:,} км.".replace(",", " "))
    if engine_volume_cc:
        parts.append(f"Объём двигателя {engine_volume_cc} см³.")
    if horsepower and horsepower > 0:
        parts.append(f"Мощность {horsepower} л.с.")
    if fuel_type and str(fuel_type).strip():
        parts.append(f"Топливо: {str(fuel_type).strip()}.")
    if transmission and str(transmission).strip():
        parts.append(f"Трансмиссия: {str(transmission).strip()}.")
    if location_city and str(location_city).strip():
        parts.append(f"Город в объявлении: {str(location_city).strip()}.")
    parts.append(
        "Подробности по комплектации и состоянию можно уточнить при оформлении запроса."
    )
    return " ".join(parts)


def pick_title_ru(
    brand: str,
    model: str,
    year: int,
    raw_title: str | None,
    translated: str | None,
) -> str:
    """
    Итоговый заголовок: при нормальном переводе с китайского можно оставить краткий вариант;
    при мусоре — только шаблон из марки/модели/года.
    """
    for candidate in (translated, raw_title):
        if candidate and not title_looks_corrupted(candidate):
            c = str(candidate).strip()
            if len(c) > 180:
                c = c[:177].rsplit(" ", 1)[0] + "…"
            # Латиница/кириллица/цифры — ок; если остался чистый китайский без перевода
            if re.search(r"[\u4e00-\u9fff]", c) and not re.search(r"[А-Яа-яЁё]", c):
                continue
            return c
    return russian_listing_title(brand, model, year)
