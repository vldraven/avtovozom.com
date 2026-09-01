"""Публикация объявления в канал MAX + учёт в car_external_publications."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .listing_compose import ListingMarketingCompose
from .max_client import (
    MAX_CHANNEL_PHOTOS,
    MaxApiError,
    load_max_config_from_env,
    mask_chat_id,
    max_is_configured,
    publish_listing_to_channel,
)
from .models import CarExternalPublication
from .vk_publish import build_default_vk_post_text

CHANNEL = "max"


def get_max_publication(db: Session, car_id: int) -> CarExternalPublication | None:
    return db.execute(
        select(CarExternalPublication).where(
            CarExternalPublication.car_id == car_id,
            CarExternalPublication.channel == CHANNEL,
        )
    ).scalar_one_or_none()


def build_default_max_post_text(compose: ListingMarketingCompose) -> str:
    return build_default_vk_post_text(compose)


def max_integration_status() -> dict[str, Any]:
    cfg = load_max_config_from_env()
    if cfg is None:
        return {
            "configured": False,
            "channel_chat_id_preview": None,
        }
    return {
        "configured": True,
        "channel_chat_id_preview": mask_chat_id(cfg.channel_chat_id),
    }


def build_max_compose_response(
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
            "max_message_id": publication.avito_item_id,
            "max_url": publication.avito_url,
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
        "default_text": build_default_max_post_text(compose),
        "max_photos": MAX_CHANNEL_PHOTOS,
        "max_configured": max_is_configured(),
        "publication": pub_block,
    }


def publish_car_to_max(
    db: Session,
    *,
    car_id: int,
    text: str,
    photo_urls: list[str],
    listing_web_url: str,
) -> tuple[bool, str | None, dict[str, Any]]:
    """
    Публикует в канал MAX и upsert CarExternalPublication(channel=max).
    Для channel=max поля avito_item_id / avito_url хранят message id и URL поста.
    """
    pub = get_max_publication(db, car_id)
    if pub is None:
        pub = CarExternalPublication(
            car_id=car_id,
            channel=CHANNEL,
            feed_ad_id=f"max-{car_id}",
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
        result = publish_listing_to_channel(
            message=text,
            photo_urls=photo_urls,
            listing_web_url=listing_web_url or None,
        )
    except MaxApiError as exc:
        pub.status = "error"
        pub.last_error = str(exc)[:2000]
        db.commit()
        return False, str(exc), {
            "publication_status": pub.status,
            "max_message_id": None,
            "max_url": None,
        }
    except Exception as exc:
        pub.status = "error"
        pub.last_error = str(exc)[:2000]
        db.commit()
        return False, f"Сбой публикации в MAX: {exc}", {
            "publication_status": pub.status,
            "max_message_id": None,
            "max_url": None,
        }

    pub.status = "published"
    pub.avito_item_id = result.message_id
    pub.avito_url = result.post_url
    pub.published_at = datetime.utcnow()
    pub.last_error = None
    snapshot["max_message_id"] = result.message_id
    snapshot["max_url"] = result.post_url
    pub.compose_snapshot_json = json.dumps(snapshot, ensure_ascii=False)
    db.commit()
    db.refresh(pub)

    return True, None, {
        "publication_status": pub.status,
        "max_message_id": result.message_id,
        "max_url": result.post_url,
    }
