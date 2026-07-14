"""Справочники и маппинг локальных значений avtovozom → Avito Autoload."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .body_colors import BODY_COLOR_LABEL_BY_SLUG, label_for_slug
from .models import AvitoFieldMapping

AVITO_BODY_TYPES: tuple[str, ...] = (
    "Седан",
    "Хэтчбек",
    "Универсал",
    "Внедорожник",
    "Кроссовер",
    "Купе",
    "Минивэн",
    "Пикап",
    "Фургон",
    "Кабриолет",
    "Лифтбек",
)

AVITO_DRIVE_TYPES: tuple[str, ...] = (
    "Передний",
    "Задний",
    "Полный",
)

AVITO_CAR_TYPES: tuple[str, ...] = (
    "С пробегом",
    "Новые",
)

AVITO_REGIONS: tuple[str, ...] = (
    "Москва",
    "Московская область",
    "Санкт-Петербург",
    "Ленинградская область",
    "Краснодарский край",
    "Ростовская область",
    "Свердловская область",
    "Новосибирская область",
    "Татарстан",
    "Башкортостан",
)

# Локальное fuel_type (как в БД) → Avito FuelType
_STATIC_FUEL_MAP: dict[str, str] = {
    "бензин": "Бензин",
    "benzine": "Бензин",
    "petrol": "Бензин",
    "gasoline": "Бензин",
    "汽油": "Бензин",
    "diesel": "Дизель",
    "дизель": "Дизель",
    "柴油": "Дизель",
    "электро": "Электро",
    "electric": "Электро",
    "ev": "Электро",
    "纯电": "Электро",
    "гибрид": "Гибрид",
    "hybrid": "Гибрид",
    "phev": "Гибрид",
    "plug-in hybrid": "Гибрид",
    "混动": "Гибрид",
    "газ": "Газ",
    "lpg": "Газ",
    "cng": "Газ",
}

_STATIC_TRANSMISSION_MAP: dict[str, str] = {
    "автомат": "Автомат",
    "automatic": "Автомат",
    "at": "Автомат",
    "auto": "Автомат",
    "автоматическая": "Автомат",
    "自动": "Автомат",
    "механика": "Механика",
    "manual": "Механика",
    "mt": "Механика",
    "механическая": "Механика",
    "手动": "Механика",
    "вариатор": "Вариатор",
    "cvt": "Вариатор",
    "无级": "Вариатор",
    "робот": "Робот",
    "robot": "Робот",
    "amt": "Робот",
    "dct": "Робот",
    "dsg": "Робот",
    "dual clutch": "Робот",
}


def _norm_key(value: str | None) -> str:
    return (value or "").strip().lower()


def feed_ad_id_for_car(car_id: int) -> str:
    return f"avtovozom-{car_id}"


def _lookup_db_mapping(db: Session | None, entity_type: str, local_value: str | None) -> str | None:
    if db is None or not local_value:
        return None
    key = local_value.strip()
    if not key:
        return None
    row = db.execute(
        select(AvitoFieldMapping.avito_value).where(
            AvitoFieldMapping.entity_type == entity_type,
            AvitoFieldMapping.local_value == key,
        )
    ).scalar_one_or_none()
    return row


def map_brand(db: Session | None, brand_name: str | None) -> str | None:
    if not brand_name:
        return None
    mapped = _lookup_db_mapping(db, "brand", brand_name)
    return mapped or brand_name.strip()


def map_model(db: Session | None, model_name: str | None) -> str | None:
    if not model_name:
        return None
    mapped = _lookup_db_mapping(db, "model", model_name)
    return mapped or model_name.strip()


def map_fuel(db: Session | None, fuel_type: str | None) -> str | None:
    if not fuel_type:
        return None
    mapped = _lookup_db_mapping(db, "fuel", fuel_type)
    if mapped:
        return mapped
    return _STATIC_FUEL_MAP.get(_norm_key(fuel_type))


def map_transmission(db: Session | None, transmission: str | None) -> str | None:
    if not transmission:
        return None
    mapped = _lookup_db_mapping(db, "transmission", transmission)
    if mapped:
        return mapped
    return _STATIC_TRANSMISSION_MAP.get(_norm_key(transmission))


def map_color(db: Session | None, body_color_slug: str | None) -> str | None:
    if not body_color_slug:
        return None
    mapped = _lookup_db_mapping(db, "color", body_color_slug)
    if mapped:
        return mapped
    label = label_for_slug(body_color_slug)
    if label:
        return label
    return BODY_COLOR_LABEL_BY_SLUG.get(body_color_slug.strip().lower())
