"""Генерация XML-фида Avito Autoload для категории «Автомобили»."""

from __future__ import annotations

import html
import os
from dataclasses import dataclass, field
from datetime import date
from typing import Any
from xml.etree.ElementTree import Element, SubElement, tostring

from sqlalchemy.orm import Session

from .avito_mappings import (
    map_brand,
    map_color,
    map_fuel,
    map_model,
    map_transmission,
)
from .models import Car, CarExternalPublication

MAX_AVITO_PHOTOS = 20
AVITO_CATEGORY = "Автомобили"


@dataclass
class AvitoComposeOverrides:
    description: str = ""
    region: str = ""
    car_type: str = ""
    body_type: str = ""
    drive_type: str = ""
    contact_phone: str = ""
    make: str = ""
    model: str = ""
    photo_urls: list[str] = field(default_factory=list)
    price_rub: int | None = None
    deactivated: bool = False


def _env_default(name: str, fallback: str) -> str:
    return (os.getenv(name) or fallback).strip()


def default_car_type() -> str:
    return _env_default("AVITO_CAR_TYPE", "С пробегом")


def default_region() -> str:
    return _env_default("AVITO_DEFAULT_REGION", "Москва")


def default_contact_phone() -> str:
    return _env_default("AVITO_DEFAULT_CONTACT_PHONE", "")


def build_description_footer(canonical_web_url: str) -> str:
    return (
        f"\n\nПодробности и комплектация на сайте: {canonical_web_url}\n"
        "Доставка автомобилей из Китая под ключ, таможенное оформление."
    )


def _text_el(parent: Element, tag: str, value: str | int | None) -> None:
    if value is None:
        return
    s = str(value).strip()
    if not s:
        return
    el = SubElement(parent, tag)
    el.text = s


def _validate_ad_context(ctx: dict[str, Any]) -> list[str]:
    warnings: list[str] = []
    if not ctx.get("make"):
        warnings.append("Марка не сопоставлена с Avito — укажите Make вручную")
    if not ctx.get("model"):
        warnings.append("Модель не сопоставлена с Avito — укажите Model вручную")
    if ctx.get("price_rub") is None or int(ctx.get("price_rub") or 0) <= 0:
        warnings.append("Не удалось рассчитать цену в рублях")
    if not ctx.get("region"):
        warnings.append("Не указан регион (Region)")
    if not ctx.get("contact_phone"):
        warnings.append("Не указан контактный телефон (ContactPhone)")
    if not ctx.get("photo_urls"):
        warnings.append("Не выбрано ни одного фото")
    if not ctx.get("body_type"):
        warnings.append("Не указан тип кузова (BodyType) — выберите в форме")
    if not ctx.get("drive_type"):
        warnings.append("Не указан привод (DriveType) — выберите в форме")
    if ctx.get("mileage_km") is None and ctx.get("car_type") == "С пробегом":
        warnings.append("Не указан пробег (Kilometrage)")
    return warnings


def build_ad_context(
    car: Car,
    *,
    db: Session | None,
    canonical_web_url: str,
    estimated_total_rub: float | None,
    overrides: AvitoComposeOverrides | None = None,
    absolute_photo_urls: list[str] | None = None,
) -> dict[str, Any]:
    ov = overrides or AvitoComposeOverrides()
    make = (ov.make or map_brand(db, car.brand.name if car.brand else None) or "").strip()
    model = (ov.model or map_model(db, car.model.name if car.model else None) or "").strip()
    region = (ov.region or default_region()).strip()
    car_type = (ov.car_type or default_car_type()).strip()
    body_type = (ov.body_type or "Седан").strip()
    drive_type = (ov.drive_type or "Передний").strip()
    contact_phone = (ov.contact_phone or default_contact_phone()).strip()

    desc_base = (ov.description or (car.description or "").strip()).strip()
    if canonical_web_url and canonical_web_url not in desc_base:
        desc_base = f"{desc_base}{build_description_footer(canonical_web_url)}".strip()

    price_rub: int | None = ov.price_rub
    if price_rub is None and estimated_total_rub is not None:
        price_rub = int(round(float(estimated_total_rub)))

    photos = list(ov.photo_urls or absolute_photo_urls or [])[:MAX_AVITO_PHOTOS]

    engine_liters = ""
    if car.engine_volume_cc and car.engine_volume_cc > 0:
        engine_liters = f"{car.engine_volume_cc / 1000:.1f}".replace(".", ".")

    ctx = {
        "feed_ad_id": f"avtovozom-{car.id}",
        "make": make,
        "model": model,
        "year": car.year,
        "mileage_km": car.mileage_km,
        "price_rub": price_rub,
        "description": desc_base,
        "region": region,
        "car_type": car_type,
        "body_type": body_type,
        "drive_type": drive_type,
        "contact_phone": contact_phone,
        "fuel_type": map_fuel(db, car.fuel_type),
        "transmission": map_transmission(db, car.transmission),
        "power": car.horsepower if car.horsepower and car.horsepower > 0 else None,
        "engine_size": engine_liters,
        "color": map_color(db, car.body_color_slug),
        "photo_urls": photos,
        "deactivated": ov.deactivated,
    }
    ctx["warnings"] = _validate_ad_context(ctx)
    return ctx


def ad_context_from_publication(pub: CarExternalPublication) -> AvitoComposeOverrides | None:
    import json

    try:
        snap = json.loads(pub.compose_snapshot_json or "{}")
    except json.JSONDecodeError:
        return None
    if not isinstance(snap, dict):
        return None
    return AvitoComposeOverrides(
        description=str(snap.get("description") or ""),
        region=str(snap.get("region") or ""),
        car_type=str(snap.get("car_type") or ""),
        body_type=str(snap.get("body_type") or ""),
        drive_type=str(snap.get("drive_type") or ""),
        contact_phone=str(snap.get("contact_phone") or ""),
        make=str(snap.get("make") or ""),
        model=str(snap.get("model") or ""),
        photo_urls=list(snap.get("photo_urls") or []),
        price_rub=int(snap["price_rub"]) if snap.get("price_rub") is not None else None,
        deactivated=pub.status == "deactivated",
    )


def render_ad_xml(ctx: dict[str, Any]) -> str:
    ad = Element("Ad")
    _text_el(ad, "Id", ctx["feed_ad_id"])
    if ctx.get("deactivated"):
        _text_el(ad, "AdStatus", "Deleted")
    _text_el(ad, "DateBegin", date.today().isoformat())
    _text_el(ad, "Category", AVITO_CATEGORY)
    _text_el(ad, "CarType", ctx.get("car_type"))
    _text_el(ad, "Price", ctx.get("price_rub"))
    if ctx.get("mileage_km") is not None:
        _text_el(ad, "Kilometrage", ctx.get("mileage_km"))
    _text_el(ad, "Description", ctx.get("description"))
    _text_el(ad, "Region", ctx.get("region"))
    _text_el(ad, "ContactPhone", ctx.get("contact_phone"))
    _text_el(ad, "Make", ctx.get("make"))
    _text_el(ad, "Model", ctx.get("model"))
    _text_el(ad, "Year", ctx.get("year"))
    _text_el(ad, "BodyType", ctx.get("body_type"))
    _text_el(ad, "DriveType", ctx.get("drive_type"))
    _text_el(ad, "FuelType", ctx.get("fuel_type"))
    _text_el(ad, "Transmission", ctx.get("transmission"))
    _text_el(ad, "Power", ctx.get("power"))
    _text_el(ad, "EngineSize", ctx.get("engine_size"))
    _text_el(ad, "Color", ctx.get("color"))

    images = ctx.get("photo_urls") or []
    if images:
        images_el = SubElement(ad, "Images")
        for url in images:
            u = str(url).strip()
            if u:
                SubElement(images_el, "Image", url=u)

    xml_body = tostring(ad, encoding="unicode")
    return f'<?xml version="1.0" encoding="UTF-8"?>\n{xml_body}'


def render_feed_xml(ad_xml_blocks: list[str]) -> str:
    inner = "\n".join(block.replace('<?xml version="1.0" encoding="UTF-8"?>\n', "") for block in ad_xml_blocks)
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<Ads>\n{inner}\n</Ads>'


def escape_preview(text: str) -> str:
    return html.escape(text or "")
