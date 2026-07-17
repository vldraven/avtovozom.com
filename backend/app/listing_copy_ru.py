"""
Заголовок и нейтральное описание объявления без данных продавца.

Название (title) храним на английском / латинице (Brand Model Trim), без перевода на русский.
"""

from __future__ import annotations

import re


def title_looks_like_global_seo_english(s: str | None) -> bool:
    """SEO-заголовок global.che168 (англ.) — не использовать как название объявления."""
    if not s or not str(s).strip():
        return False
    t = str(s).strip()
    tl = t.lower()
    if tl.startswith("used "):
        return True
    seo_markers = (
        "for sale",
        "near me",
        "cheap price",
        "5-seater",
        "second hand",
        "china used cars",
    )
    hits = sum(1 for m in seo_markers if m in tl)
    return hits >= 2 or (hits >= 1 and " - " in t and len(t) > 60)


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


def title_is_mostly_cyrillic(s: str | None) -> bool:
    """Переведённый на русский заголовок — не используем для поля title."""
    if not s:
        return False
    t = str(s).strip()
    cyr = len(re.findall(r"[А-Яа-яЁё]", t))
    lat = len(re.findall(r"[A-Za-z]", t))
    return cyr >= 3 and cyr > lat


def title_has_usable_latin(s: str | None) -> bool:
    """Есть латиница (марка/модель/комплектация) — подходит для title."""
    if not s:
        return False
    return bool(re.search(r"[A-Za-z]{2,}", str(s)))


def english_listing_title(brand: str, model: str, year: int, series_raw: str | None = None) -> str:
    """Краткий заголовок на английском: Brand Model [Trim] [Year]."""
    b = (brand or "").strip()
    m = (model or "").strip()
    trim = (series_raw or "").strip()
    y = int(year) if year else 0
    parts: list[str] = []
    if b:
        parts.append(b)
    if m and m.lower() not in (b.lower() if b else ""):
        parts.append(m)
    if trim:
        blob = " ".join(parts).lower()
        if trim.lower() not in blob:
            # Китайский trim без латиницы пропускаем
            if title_has_usable_latin(trim) and not re.search(r"[\u4e00-\u9fff]", trim):
                parts.append(trim)
            elif not re.search(r"[\u4e00-\u9fff]", trim):
                parts.append(trim)
    if y and str(y) not in " ".join(parts):
        parts.append(str(y))
    return " ".join(parts) if parts else "Car"


def russian_listing_title(brand: str, model: str, year: int) -> str:
    """Обратная совместимость: шаблон без «г.в.» — латиница Brand Model Year."""
    return english_listing_title(brand, model, year)


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
    body_color_label: str | None = None,
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
    if body_color_label and str(body_color_label).strip():
        parts.append(f"Цвет кузова (по данным объявления): {str(body_color_label).strip()}.")
    if location_city and str(location_city).strip():
        parts.append(f"Город в объявлении: {str(location_city).strip()}.")
    parts.append(
        "Подробности по комплектации и состоянию можно уточнить при оформлении запроса."
    )
    return " ".join(parts)


def pick_listing_title(
    brand: str,
    model: str,
    year: int,
    raw_title: str | None,
    series_raw: str | None = None,
    translated: str | None = None,
) -> str:
    """
    Итоговый title: без перевода на русский.
    Предпочитаем исходное название с латиницей (Brand Model Trim); SEO/мусор/кириллицу отбрасываем.
    """
    for candidate in (raw_title, series_raw):
        if not candidate:
            continue
        if title_looks_corrupted(candidate):
            continue
        if title_looks_like_global_seo_english(candidate):
            continue
        if title_is_mostly_cyrillic(candidate):
            continue
        c = str(candidate).strip()
        if len(c) > 180:
            c = c[:177].rsplit(" ", 1)[0] + "…"
        # Чистый китайский без латиницы — не подходит
        if re.search(r"[\u4e00-\u9fff]", c) and not title_has_usable_latin(c):
            continue
        return c

    # translated только если без кириллицы и с латиницей (на случай ошибочного вызова)
    if (
        translated
        and not title_looks_corrupted(translated)
        and not title_looks_like_global_seo_english(translated)
        and not title_is_mostly_cyrillic(translated)
        and title_has_usable_latin(translated)
        and not re.search(r"[\u4e00-\u9fff]", str(translated))
    ):
        c = str(translated).strip()
        if len(c) > 180:
            c = c[:177].rsplit(" ", 1)[0] + "…"
        return c

    return english_listing_title(brand, model, year, series_raw)


def pick_title_ru(
    brand: str,
    model: str,
    year: int,
    raw_title: str | None,
    translated: str | None,
) -> str:
    """Обратная совместимость: title без перевода на русский."""
    return pick_listing_title(brand, model, year, raw_title, translated=translated)
