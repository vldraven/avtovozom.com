"""Публикация объявления в группу VK + учёт в car_external_publications."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .listing_compose import ListingMarketingCompose
from .models import CarExternalPublication
from .vk_client import (
    MAX_WALL_PHOTOS,
    VkApiError,
    publish_listing_to_group,
    vk_is_configured,
)

CHANNEL = "vk"


def get_vk_publication(db: Session, car_id: int) -> CarExternalPublication | None:
    return db.execute(
        select(CarExternalPublication).where(
            CarExternalPublication.car_id == car_id,
            CarExternalPublication.channel == CHANNEL,
        )
    ).scalar_one_or_none()


def build_default_vk_post_text(compose: ListingMarketingCompose) -> str:
    lines: list[str] = [compose.title.strip() or f"{compose.brand} {compose.model}"]
    bits: list[str] = []
    if compose.year:
        bits.append(str(compose.year))
    if compose.mileage_km is not None:
        bits.append(f"{compose.mileage_km:,} км".replace(",", " "))
    if compose.engine_volume_cc:
        bits.append(f"{compose.engine_volume_cc} см³")
    if compose.horsepower:
        bits.append(f"{compose.horsepower} л.с.")
    if compose.transmission:
        bits.append(str(compose.transmission))
    if compose.fuel_type:
        bits.append(str(compose.fuel_type))
    if bits:
        lines.append(" · ".join(bits))
    if compose.estimated_total_rub is not None:
        lines.append(
            f"Ориентир цены в РФ: ~{int(round(compose.estimated_total_rub)):,} ₽".replace(",", " ")
        )
    elif compose.rub_china is not None:
        lines.append(
            f"Цена в Китае: ~{int(round(compose.rub_china)):,} ₽".replace(",", " ")
        )
    lines.append("")
    lines.append("Доставка из Китая под ключ · расчёт на сайте")
    if compose.canonical_web_url:
        lines.append(compose.canonical_web_url)
    return "\n".join(lines).strip()


def build_vk_compose_response(
    compose: ListingMarketingCompose,
    *,
    publication: CarExternalPublication | None,
) -> dict[str, Any]:
    pub_block: dict[str, Any] | None = None
    if publication:
        snap: dict[str, Any] = {}
        try:
            snap = json.loads(publication.compose_snapshot_json or "{}")
        except json.JSONDecodeError:
            snap = {}
        pub_block = {
            "status": publication.status,
            "vk_post_id": publication.avito_item_id,
            "vk_url": publication.avito_url,
            "last_error": publication.last_error,
            "published_at": publication.published_at.isoformat() if publication.published_at else None,
            "last_text_preview": (snap.get("text") or "")[:200] or None,
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
            {
                "id": p[0],
                "storage_url": p[1],
                "sort_order": p[2],
                "absolute_url": p[3],
            }
            for p in compose.photos
        ],
        "default_text": build_default_vk_post_text(compose),
        "max_photos": MAX_WALL_PHOTOS,
        "vk_configured": vk_is_configured(),
        "publication": pub_block,
    }


def publish_car_to_vk(
    db: Session,
    *,
    car_id: int,
    text: str,
    photo_urls: list[str],
    listing_web_url: str,
) -> tuple[bool, str | None, dict[str, Any]]:
    """
    Публикует на стену группы и upsert CarExternalPublication(channel=vk).
    Для channel=vk поля avito_item_id / avito_url хранят post_id и URL стены.
    """
    pub = get_vk_publication(db, car_id)
    if pub is None:
        pub = CarExternalPublication(
            car_id=car_id,
            channel=CHANNEL,
            feed_ad_id=f"vk-{car_id}",
            status="draft",
        )
        db.add(pub)
        db.flush()

    snapshot = {
        "text": text,
        "photo_urls": photo_urls,
        "listing_web_url": listing_web_url,
    }
    pub.compose_snapshot_json = json.dumps(snapshot, ensure_ascii=False)
    pub.status = "pending_upload"
    pub.last_error = None
    db.commit()
    db.refresh(pub)

    try:
        result = publish_listing_to_group(
            message=text,
            photo_urls=photo_urls,
            listing_web_url=listing_web_url,
        )
    except VkApiError as exc:
        pub.status = "error"
        pub.last_error = str(exc)[:2000]
        db.commit()
        return False, str(exc), {
            "publication_status": pub.status,
            "vk_post_id": None,
            "vk_url": None,
        }
    except Exception as exc:
        pub.status = "error"
        pub.last_error = str(exc)[:2000]
        db.commit()
        return False, f"Сбой публикации в VK: {exc}", {
            "publication_status": pub.status,
            "vk_post_id": None,
            "vk_url": None,
        }

    pub.status = "published"
    pub.avito_item_id = result.post_id
    pub.avito_url = result.wall_url
    pub.published_at = datetime.utcnow()
    pub.last_error = None
    snapshot["vk_post_id"] = result.post_id
    snapshot["vk_url"] = result.wall_url
    pub.compose_snapshot_json = json.dumps(snapshot, ensure_ascii=False)
    db.commit()
    db.refresh(pub)

    return True, None, {
        "publication_status": pub.status,
        "vk_post_id": result.post_id,
        "vk_url": result.wall_url,
    }
