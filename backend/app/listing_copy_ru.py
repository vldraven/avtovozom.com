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


_CJK_CHAR_RE = re.compile(
    r"[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff"
    r"\u3040-\u30ff\uac00-\ud7af]"  # CJK + японский/корейский в заголовках che168
)


def title_contains_cjk(s: str | None) -> bool:
    if not s:
        return False
    return bool(_CJK_CHAR_RE.search(str(s)))


def normalize_latin_listing_title(s: str | None) -> str:
    """
    Убрать китайский/иероглифы, оставить латиницу, цифры и обычную пунктуацию.
    Пример: «马自达CX-5 2021款 2.0L …» → «CX-5 2021 2.0L …».
    """
    if not s:
        return ""
    t = _CJK_CHAR_RE.sub(" ", str(s))
    t = re.sub(r"\s+", " ", t).strip(" -·,，")
    return t


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
        trim = normalize_latin_listing_title(trim)
        blob = " ".join(parts).lower()
        if trim and trim.lower() not in blob and title_has_usable_latin(trim):
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
    Итоговый title: латиница/цифры (Brand Model Trim), без китайского и без перевода на русский.
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
        c = normalize_latin_listing_title(str(candidate).strip())
        if not c or not title_has_usable_latin(c):
            continue
        if len(c) > 180:
            c = c[:177].rsplit(" ", 1)[0] + "…"
        if title_contains_cjk(c):
            continue
        return c

    # translated только если без кириллицы и без иероглифов
    if translated and not title_looks_corrupted(translated):
        c = normalize_latin_listing_title(str(translated).strip())
        if (
            c
            and title_has_usable_latin(c)
            and not title_looks_like_global_seo_english(c)
            and not title_is_mostly_cyrillic(c)
            and not title_contains_cjk(c)
        ):
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
