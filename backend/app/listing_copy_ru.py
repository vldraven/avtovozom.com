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


def _latin_trim_from_sources(
    brand: str,
    model: str,
    year: int,
    raw_title: str | None,
    series_raw: str | None,
) -> str:
    """Комплектация латиницей: из объявления без марки/модели/года."""
    best = ""
    for src in (raw_title, series_raw):
        if not src or title_looks_corrupted(src):
            continue
        if title_looks_like_global_seo_english(src):
            continue
        if title_is_mostly_cyrillic(src):
            continue
        c = normalize_latin_listing_title(str(src).strip())
        if not c or not title_has_usable_latin(c) or title_contains_cjk(c):
            continue
        if len(c) > len(best):
            best = c
    if not best:
        return ""

    blob = best
    b = (brand or "").strip()
    m = (model or "").strip()
    y = int(year) if year else 0

    if b:
        blob = re.sub(re.escape(b), " ", blob, flags=re.IGNORECASE)
    if m:
        blob = re.sub(re.escape(m), " ", blob, flags=re.IGNORECASE)
    if m:
        # «3 Series» → убрать отдельное «3» из «3 2022 320Li»
        head = m.split()[0]
        if head and re.fullmatch(r"\d+[A-Za-z]?", head):
            blob = re.sub(rf"\b{re.escape(head)}\b", " ", blob, flags=re.IGNORECASE)
    if y:
        blob = re.sub(rf"\b{y}\b", " ", blob)
    blob = re.sub(
        r"\b(used|for sale|near me|second hand|china used cars)\b",
        " ",
        blob,
        flags=re.IGNORECASE,
    )
    blob = re.sub(r"\s+", " ", blob).strip(" -·,，")
    return blob


def catalog_english_listing_title(
    brand: str,
    model: str,
    year: int,
    raw_title: str | None = None,
    series_raw: str | None = None,
) -> str:
    """
    Заголовок каталога: Brand Model Year [Trim на латинице].
    Марка и модель — из справочника (англ.), комплектация — из объявления.
    """
    b = (brand or "").strip()
    m = (model or "").strip()
    y = int(year) if year else 0
    parts: list[str] = []
    if b:
        parts.append(b)
    if m and m.lower() not in (b.lower() if b else ""):
        parts.append(m)
    if y:
        parts.append(str(y))
    trim = _latin_trim_from_sources(b, m, y, raw_title, series_raw)
    if trim:
        core = " ".join(parts).lower()
        if trim.lower() not in core:
            parts.append(trim)
    title = " ".join(parts).strip()
    if len(title) > 180:
        title = title[:177].rsplit(" ", 1)[0] + "…"
    return title or "Car"


def english_listing_title(brand: str, model: str, year: int, series_raw: str | None = None) -> str:
    """Краткий заголовок: Brand Model Year [Trim]."""
    return catalog_english_listing_title(brand, model, year, series_raw=series_raw)


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
    Итоговый title: Brand Model Year + комплектация на латинице, без китайского и кириллицы.
    """
    title = catalog_english_listing_title(
        brand, model, year, raw_title=raw_title, series_raw=series_raw
    )
    if title != "Car":
        return title

    if translated and not title_looks_corrupted(translated):
        c = normalize_latin_listing_title(str(translated).strip())
        if (
            c
            and title_has_usable_latin(c)
            and not title_looks_like_global_seo_english(c)
            and not title_is_mostly_cyrillic(c)
            and not title_contains_cjk(c)
        ):
            return catalog_english_listing_title(
                brand, model, year, raw_title=c, series_raw=series_raw
            )

    return catalog_english_listing_title(brand, model, year, series_raw=series_raw)


def pick_title_ru(
    brand: str,
    model: str,
    year: int,
    raw_title: str | None,
    translated: str | None,
) -> str:
    """Обратная совместимость: title без перевода на русский."""
    return pick_listing_title(brand, model, year, raw_title, translated=translated)
