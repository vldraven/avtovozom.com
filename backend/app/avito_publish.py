"""Бизнес-логика публикации объявлений на Avito Autoload."""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from . import avito_client
from .avito_feed import (
    AvitoComposeOverrides,
    ad_context_from_publication,
    build_ad_context,
    default_car_type,
    default_contact_phone,
    default_region,
    render_ad_xml,
    render_feed_xml,
)
from .avito_mappings import (
    AVITO_BODY_TYPES,
    AVITO_CAR_TYPES,
    AVITO_DRIVE_TYPES,
    AVITO_REGIONS,
    feed_ad_id_for_car,
)
from .listing_compose import ListingMarketingCompose
from .models import Car, CarExternalPublication

ACTIVE_FEED_STATUSES = frozenset({"pending_upload", "published"})


def _compose_snapshot_from_overrides(
    overrides: AvitoComposeOverrides,
    *,
    estimated_total_rub: float | None,
) -> dict[str, Any]:
    return {
        "description": overrides.description,
        "region": overrides.region,
        "car_type": overrides.car_type,
        "body_type": overrides.body_type,
        "drive_type": overrides.drive_type,
        "contact_phone": overrides.contact_phone,
        "make": overrides.make,
        "model": overrides.model,
        "photo_urls": overrides.photo_urls,
        "price_rub": overrides.price_rub
        if overrides.price_rub is not None
        else (int(round(estimated_total_rub)) if estimated_total_rub else None),
    }


def get_publication(db: Session, car_id: int) -> CarExternalPublication | None:
    return db.execute(
        select(CarExternalPublication).where(
            CarExternalPublication.car_id == car_id,
            CarExternalPublication.channel == "avito",
        )
    ).scalar_one_or_none()


def build_avito_compose_response(
    compose: ListingMarketingCompose,
    *,
    db: Session,
    car: Car,
    publication: CarExternalPublication | None,
) -> dict[str, Any]:
    overrides = AvitoComposeOverrides(
        description=compose.description,
        region=default_region(),
        car_type=default_car_type(),
        body_type="Седан",
        drive_type="Передний",
        contact_phone=default_contact_phone(),
    )
    if publication:
        loaded = ad_context_from_publication(publication)
        if loaded:
            overrides = loaded

    ctx = build_ad_context(
        car,
        db=db,
        canonical_web_url=compose.canonical_web_url,
        estimated_total_rub=compose.estimated_total_rub,
        overrides=overrides,
        absolute_photo_urls=[p[3] for p in compose.photos],
    )

    pub_block: dict[str, Any] | None = None
    if publication:
        pub_block = {
            "status": publication.status,
            "feed_ad_id": publication.feed_ad_id,
            "avito_item_id": publication.avito_item_id,
            "avito_url": publication.avito_url,
            "last_error": publication.last_error,
            "published_at": publication.published_at.isoformat() if publication.published_at else None,
        }

    return {
        "car_id": compose.car_id,
        "title": compose.title,
        "brand": compose.brand,
        "model": compose.model,
        "generation": compose.generation,
        "year": compose.year,
        "mileage_km": compose.mileage_km,
        "engine_volume_cc": compose.engine_volume_cc,
        "horsepower": compose.horsepower,
        "fuel_type": compose.fuel_type,
        "transmission": compose.transmission,
        "location_city": compose.location_city,
        "price_cny": compose.price_cny,
        "description": compose.description,
        "rub_china": compose.rub_china,
        "estimated_total_rub": compose.estimated_total_rub,
        "canonical_path": compose.canonical_path,
        "canonical_web_url": compose.canonical_web_url,
        "photos": [
            {"id": p[0], "storage_url": p[1], "sort_order": p[2], "absolute_url": p[3]}
            for p in compose.photos
        ],
        "defaults": {
            "region": default_region(),
            "car_type": default_car_type(),
            "contact_phone": default_contact_phone(),
            "body_type": "Седан",
            "drive_type": "Передний",
        },
        "options": {
            "regions": list(AVITO_REGIONS),
            "car_types": list(AVITO_CAR_TYPES),
            "body_types": list(AVITO_BODY_TYPES),
            "drive_types": list(AVITO_DRIVE_TYPES),
        },
        "mapped": {
            "make": ctx.get("make"),
            "model": ctx.get("model"),
            "fuel_type": ctx.get("fuel_type"),
            "transmission": ctx.get("transmission"),
            "color": ctx.get("color"),
        },
        "warnings": ctx.get("warnings") or [],
        "avito_configured": avito_client.avito_configured(),
        "publication": pub_block,
    }


def publish_to_avito(
    db: Session,
    car: Car,
    *,
    overrides: AvitoComposeOverrides,
    estimated_total_rub: float | None,
    trigger_upload: bool = True,
) -> tuple[bool, str | None, CarExternalPublication]:
    feed_ad_id = feed_ad_id_for_car(car.id)
    snap = _compose_snapshot_from_overrides(overrides, estimated_total_rub=estimated_total_rub)

    pub = get_publication(db, car.id)
    now = datetime.utcnow()
    if pub is None:
        pub = CarExternalPublication(
            car_id=car.id,
            channel="avito",
            feed_ad_id=feed_ad_id,
            status="pending_upload",
            compose_snapshot_json=json.dumps(snap, ensure_ascii=False),
            published_at=now,
        )
        db.add(pub)
    else:
        pub.feed_ad_id = feed_ad_id
        pub.status = "pending_upload"
        pub.compose_snapshot_json = json.dumps(snap, ensure_ascii=False)
        pub.last_error = None
        pub.published_at = now
        pub.updated_at = now

    db.commit()
    db.refresh(pub)

    upload_detail: str | None = None
    if trigger_upload:
        if not avito_client.avito_configured():
            pub.status = "error"
            pub.last_error = "AVITO_CLIENT_ID / AVITO_CLIENT_SECRET не заданы"
            db.commit()
            return False, pub.last_error, pub
        try:
            result = avito_client.trigger_upload()
            upload_id = str(result.get("upload_id") or result.get("report_id") or result.get("id") or "")
            if upload_id:
                pub.last_upload_id = upload_id
            db.commit()
            upload_detail = "Загрузка на Avito запущена"
        except avito_client.AvitoApiError as e:
            pub.status = "error"
            pub.last_error = str(e)[:1000]
            db.commit()
            return False, str(e), pub

    return True, upload_detail, pub


def refresh_avito_status(db: Session, car_id: int) -> tuple[CarExternalPublication | None, dict[str, Any]]:
    pub = get_publication(db, car_id)
    if pub is None:
        return None, {"ok": False, "detail": "Публикация на Avito не найдена"}

    if not avito_client.avito_configured():
        return pub, {"ok": False, "detail": "Avito API не настроен", "publication_status": pub.status}

    try:
        item = avito_client.resolve_item_status(pub.feed_ad_id)
    except avito_client.AvitoApiError as e:
        pub.last_error = str(e)[:1000]
        db.commit()
        return pub, {"ok": False, "detail": str(e), "publication_status": pub.status}

    if item is None:
        return pub, {"ok": True, "detail": "Статус пока недоступен", "publication_status": pub.status}

    if item.errors:
        pub.status = "error"
        pub.last_error = "; ".join(item.errors)[:1000]
    elif item.avito_id:
        pub.status = "published"
        pub.avito_item_id = item.avito_id
        pub.avito_url = item.url or f"https://www.avito.ru/{item.avito_id}"
        pub.last_error = None
    elif pub.status == "pending_upload":
        pass

    pub.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(pub)

    return pub, {
        "ok": True,
        "publication_status": pub.status,
        "avito_item_id": pub.avito_item_id,
        "avito_url": pub.avito_url,
        "last_error": pub.last_error,
        "item_status": item.status,
        "errors": item.errors,
    }


def generate_feed_xml(
    db: Session,
    *,
    public_web_origin: str = "",
    slug_maps: tuple[dict[int, str], dict[int, str]] | None = None,
    canonical_path_fn=None,
) -> str:
    pubs = (
        db.execute(
            select(CarExternalPublication)
            .where(
                CarExternalPublication.channel == "avito",
                CarExternalPublication.status.in_(tuple(ACTIVE_FEED_STATUSES)),
            )
            .options(
                joinedload(CarExternalPublication.car).joinedload(Car.brand),
                joinedload(CarExternalPublication.car).joinedload(Car.model),
                joinedload(CarExternalPublication.car).joinedload(Car.photos),
            )
        )
        .unique()
        .scalars()
        .all()
    )

    blocks: list[str] = []
    for pub in pubs:
        car = pub.car
        if car is None or not car.is_active:
            continue
        overrides = ad_context_from_publication(pub)
        if overrides is None:
            continue
        canonical_web_url = ""
        if canonical_path_fn and slug_maps is not None:
            path = canonical_path_fn(car, slug_maps)
            canonical_web_url = f"{public_web_origin.rstrip('/')}{path}"
        ctx = build_ad_context(
            car,
            db=db,
            canonical_web_url=canonical_web_url,
            estimated_total_rub=overrides.price_rub,
            overrides=overrides,
        )
        blocks.append(render_ad_xml(ctx))

    if not blocks:
        return render_feed_xml([])
    return render_feed_xml(blocks)


def verify_feed_secret(secret: str | None) -> bool:
    expected = (os.getenv("AVITO_FEED_SECRET") or "").strip()
    if not expected:
        return False
    return (secret or "").strip() == expected
