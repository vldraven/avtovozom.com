"""Учёт публикаций в Telegram-канал и вызов существующего n8n publish-webhook."""

from __future__ import annotations

import json
import os
from datetime import datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import exists, or_, select
from sqlalchemy.orm import Session, joinedload

from .catalog_slug import build_catalog_slug_maps
from .listing_compose import ListingMarketingCompose, build_listing_marketing_compose
from .models import Car, CarExternalPublication, CarPhoto
from .n8n_client import n8n_webhook_post

TELEGRAM_CHANNEL = "telegram"
BLOCKED_STATUSES = frozenset({"published", "pending_review"})
SKIP_TODAY_STATUS = "skipped"
MAX_TELEGRAM_PHOTOS = 10

try:
    MSK = ZoneInfo("Europe/Moscow")
except Exception:  # pragma: no cover
    MSK = timezone(timedelta(hours=3))


def msk_day_start_utc(now: datetime | None = None) -> datetime:
    """Начало текущего календарного дня MSK в naive UTC (как колонки DateTime)."""
    if now is None:
        now_msk = datetime.now(MSK)
    elif now.tzinfo is None:
        now_msk = now.replace(tzinfo=timezone.utc).astimezone(MSK)
    else:
        now_msk = now.astimezone(MSK)
    start_msk = datetime.combine(now_msk.date(), time.min, tzinfo=MSK)
    return start_msk.astimezone(timezone.utc).replace(tzinfo=None)


def msk_today_iso() -> str:
    return datetime.now(MSK).date().isoformat()

# Тот же style_hint, что кнопка «Сгенерировать» в /staff/publish-telegram.
DEFAULT_TELEGRAM_AI_STYLE_HINT = (
    "Ты консультант по продаже авто. Сгенерируй яркое продающее объявление для паблика "
    "в телеграм канале по доставке автомобилей из Китая, используй конечную цену в рублях, "
    "используй эмоджи для того, чтобы расставить акценты в тексте. Укажи, что указанная цена "
    "включает все расходы, доставку до города Москва и таможенное оформление, для расчета "
    "стоимости доставки в ваш город можно оставить заявку на расчет на сайте.\n"
    "Не используй фото в тексте.\n"
    "Добавь абзац с описанием и sales-поинтами модели, тезисы найди в интернете.\n"
    "Добавь тезис про попадание машины под льготный утилизационный сбор.\n"
    "Подробности по комплектации можно уточнить на сайте, а также вы можете заказать "
    "бесплатный отчет об авто на нашем сайте.\n"
    "В конце допиши: Или написать нам: @avtovozombot"
)


def _public_web_origin() -> str:
    return (
        os.getenv("PUBLIC_WEB_ORIGIN")
        or os.getenv("NEXT_PUBLIC_SITE_URL")
        or "http://localhost:3000"
    ).rstrip("/")


def _public_api_origin() -> str:
    raw = (os.getenv("PUBLIC_API_ORIGIN") or "").strip().rstrip("/")
    return raw or "http://localhost:8000"


def _absolute_public_asset_url(storage_url: str) -> str:
    u = (storage_url or "").strip()
    if not u:
        return ""
    if u.startswith(("http://", "https://")):
        return u
    base = _public_api_origin()
    return f"{base}{u}" if u.startswith("/") else f"{base}/{u}"


def build_social_compose(db: Session, car: Car) -> ListingMarketingCompose:
    slug_maps = build_catalog_slug_maps(db)
    est = getattr(car, "estimated_total_rub", None)
    return build_listing_marketing_compose(
        car,
        public_web_origin=_public_web_origin(),
        slug_maps=slug_maps,
        absolute_url_fn=_absolute_public_asset_url,
        rub_china=None,
        estimated_total_rub=float(est) if est is not None else None,
    )


def build_telegram_skeleton(compose: ListingMarketingCompose) -> str:
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
    if compose.fuel_type:
        bits.append(str(compose.fuel_type))
    if compose.transmission:
        bits.append(str(compose.transmission))
    if bits:
        lines.append(" · ".join(bits))
    if compose.estimated_total_rub is not None:
        lines.append(
            f"Под ключ в РФ: ~{int(round(compose.estimated_total_rub)):,} ₽".replace(",", " ")
        )
    lines.append("")
    lines.append("Доставка из Китая под ключ")
    if compose.canonical_web_url:
        lines.append(compose.canonical_web_url)
    return "\n".join(lines).strip()


def snapshot_text(pub: CarExternalPublication | None) -> str | None:
    if pub is None or not (pub.compose_snapshot_json or "").strip():
        return None
    try:
        snap = json.loads(pub.compose_snapshot_json)
    except Exception:
        return None
    if not isinstance(snap, dict):
        return None
    text = str(snap.get("text") or "").strip()
    return text or None


def get_telegram_publication(db: Session, car_id: int) -> CarExternalPublication | None:
    return db.execute(
        select(CarExternalPublication).where(
            CarExternalPublication.car_id == car_id,
            CarExternalPublication.channel == TELEGRAM_CHANNEL,
        )
    ).scalar_one_or_none()


def _read_snapshot(row: CarExternalPublication | None) -> dict[str, Any]:
    if row is None or not (row.compose_snapshot_json or "").strip():
        return {}
    try:
        snap = json.loads(row.compose_snapshot_json)
    except Exception:
        return {}
    return snap if isinstance(snap, dict) else {}


def upsert_telegram_publication(
    db: Session,
    car_id: int,
    *,
    status: str,
    text: str | None = None,
    error: str | None = None,
    commit: bool = True,
) -> CarExternalPublication:
    row = get_telegram_publication(db, car_id)
    now = datetime.utcnow()
    snap = _read_snapshot(row)
    if text:
        snap["text"] = text[:8000]
    if status == SKIP_TODAY_STATUS:
        snap["skipped_on"] = msk_today_iso()
    if row is None:
        row = CarExternalPublication(
            car_id=car_id,
            channel=TELEGRAM_CHANNEL,
            feed_ad_id=f"tg-{car_id}",
            status=status,
            last_error=error,
            compose_snapshot_json=json.dumps(snap, ensure_ascii=False),
            published_at=now if status == "published" else None,
        )
        db.add(row)
    else:
        row.status = status
        row.last_error = error
        row.compose_snapshot_json = json.dumps(snap, ensure_ascii=False)
        row.updated_at = now
        if status == "published":
            row.published_at = now
    if commit:
        db.commit()
        db.refresh(row)
    return row


def release_telegram_draft(
    db: Session,
    car_id: int,
    *,
    reason: str | None = None,
    commit: bool = True,
) -> CarExternalPublication | None:
    """Снять pending_review: лот снова в очереди (не skip)."""
    row = get_telegram_publication(db, car_id)
    if row is None:
        return None
    if row.status == "published":
        return row
    row.status = "released"
    row.last_error = (reason or "")[:500] or None
    row.published_at = None
    if commit:
        db.commit()
        db.refresh(row)
    return row


def _social_shortlist_rank(car: Car) -> tuple:
    """Детерминированный ранг шортлиста без LLM: popular → фото → свежесть."""
    created = car.created_at
    created_ts = created.timestamp() if created is not None else 0.0
    return (
        0 if bool(getattr(car, "is_popular", False)) else 1,
        -len(getattr(car, "photos", None) or []),
        -created_ts,
        -int(car.id or 0),
    )


def rank_social_shortlist(cars: list[Car], *, limit: int) -> list[Car]:
    """Сначала по одной лучшей машине каждой модели, затем добор до limit."""
    if limit <= 0 or not cars:
        return []
    ordered = sorted(cars, key=_social_shortlist_rank)
    picked: list[Car] = []
    seen_models: set[int | str] = set()
    for car in ordered:
        if len(picked) >= limit:
            return picked
        model_key: int | str = car.model_id if car.model_id else f"car:{car.id}"
        if model_key in seen_models:
            continue
        seen_models.add(model_key)
        picked.append(car)
    picked_ids = {car.id for car in picked}
    for car in ordered:
        if len(picked) >= limit:
            break
        if car.id in picked_ids:
            continue
        picked.append(car)
    return picked


def unpublished_catalog_cars(
    db: Session, *, limit: int = 40, exclude_ids: list[int] | None = None
) -> list[Car]:
    blocked_ids = (
        select(CarExternalPublication.car_id)
        .where(
            CarExternalPublication.channel == TELEGRAM_CHANNEL,
            or_(
                CarExternalPublication.status.in_(tuple(BLOCKED_STATUSES)),
                (
                    (CarExternalPublication.status == SKIP_TODAY_STATUS)
                    & (CarExternalPublication.updated_at >= msk_day_start_utc())
                ),
            ),
        )
    )
    conditions = [
        Car.is_active.is_(True),
        Car.id.not_in(blocked_ids),
        exists(select(CarPhoto.id).where(CarPhoto.car_id == Car.id)),
    ]
    if exclude_ids:
        extra = [int(x) for x in exclude_ids if str(x).isdigit() and int(x) > 0]
        if extra:
            conditions.append(Car.id.not_in(extra))
    pool_limit = min(max(int(limit) * 5, int(limit)), 80)
    stmt = (
        select(Car)
        .options(
            joinedload(Car.brand),
            joinedload(Car.model),
            joinedload(Car.generation),
            joinedload(Car.photos),
        )
        .where(*conditions)
        .order_by(Car.is_popular.desc(), Car.created_at.desc(), Car.id.desc())
        .limit(pool_limit)
    )
    pool = list(db.execute(stmt).unique().scalars().all())
    return rank_social_shortlist(pool, limit=limit)


def pending_review_cars(db: Session, *, limit: int = 20) -> list[Car]:
    pending_ids = select(CarExternalPublication.car_id).where(
        CarExternalPublication.channel == TELEGRAM_CHANNEL,
        CarExternalPublication.status == "pending_review",
    )
    stmt = (
        select(Car)
        .options(
            joinedload(Car.brand),
            joinedload(Car.model),
            joinedload(Car.generation),
            joinedload(Car.photos),
        )
        .where(Car.is_active.is_(True), Car.id.in_(pending_ids))
        .order_by(Car.updated_at.desc(), Car.id.desc())
        .limit(limit)
    )
    return list(db.execute(stmt).unique().scalars().all())


def queue_item_from_car(
    db: Session, car: Car, *, compact: bool = False
) -> dict[str, Any]:
    compose = build_social_compose(db, car)
    pub = get_telegram_publication(db, car.id)
    item: dict[str, Any] = {
        "id": car.id,
        "brand_id": car.brand_id,
        "model_id": car.model_id,
        "brand": compose.brand,
        "model": compose.model,
        "year": compose.year,
        "mileage_km": compose.mileage_km,
        "horsepower": compose.horsepower,
        "estimated_total_rub": compose.estimated_total_rub,
        "is_popular": bool(getattr(car, "is_popular", False)),
        "photo_count": len(compose.photos),
        "created_at": car.created_at.isoformat() if car.created_at else None,
        "canonical_web_url": compose.canonical_web_url,
        "telegram_status": pub.status if pub else None,
    }
    if compact:
        return item
    item.update(
        {
            "generation": compose.generation,
            "title": compose.title,
            "fuel_type": compose.fuel_type,
            "transmission": compose.transmission,
            "price_cny": compose.price_cny,
            "skeleton_text": build_telegram_skeleton(compose),
            "last_draft_text": snapshot_text(pub),
        }
    )
    return item


def compose_payload(db: Session, car: Car) -> dict[str, Any]:
    compose = build_social_compose(db, car)
    photos = [
        {
            "id": p[0],
            "sort_order": p[2],
            "absolute_url": p[3],
        }
        for p in compose.photos[:MAX_TELEGRAM_PHOTOS]
    ]
    return {
        **queue_item_from_car(db, car),
        "description": compose.description,
        "photos": photos,
        "photo_ids": [p["id"] for p in photos],
    }


def publish_telegram_via_n8n(
    *,
    car_id: int,
    listing_web_url: str,
    text: str,
    photo_urls: list[str],
) -> tuple[bool, dict[str, Any] | None, str]:
    webhook_url = os.getenv("N8N_TELEGRAM_PUBLISH_WEBHOOK_URL")
    webhook_secret = os.getenv("N8N_TELEGRAM_PUBLISH_WEBHOOK_SECRET")
    timeout = float(os.getenv("N8N_TELEGRAM_PUBLISH_TIMEOUT_SEC", "45"))
    ok, data, err = n8n_webhook_post(
        url=webhook_url,
        secret=webhook_secret,
        payload={
            "event": "telegram_publish",
            "car_id": car_id,
            "listing_web_url": listing_web_url,
            "text": text,
            "photo_urls": photo_urls[:MAX_TELEGRAM_PHOTOS],
            "media_count": min(len(photo_urls), MAX_TELEGRAM_PHOTOS),
        },
        timeout_sec=timeout,
    )
    n8n_dict = data if isinstance(data, dict) else None
    if not ok:
        return False, n8n_dict, err or "Ошибка публикации через n8n"
    if isinstance(data, dict) and data.get("ok") is False:
        return (
            False,
            n8n_dict,
            str(data.get("error") or data.get("detail") or "Отказ в n8n")[:600],
        )
    return True, n8n_dict, ""


def extract_telegram_n8n_text(data: Any) -> str:
    if isinstance(data, str):
        s = data.strip()
        if not s:
            return ""
        if s.startswith("{") and s.endswith("}"):
            try:
                return extract_telegram_n8n_text(json.loads(s))
            except json.JSONDecodeError:
                pass
        return ""
    if not isinstance(data, dict):
        return ""
    raw = data.get("text")
    if raw is None and isinstance(data.get("data"), dict):
        raw = data["data"].get("text")
    if raw is None and isinstance(data.get("body"), dict):
        raw = data["body"].get("text")
    if raw is None:
        rt = data.get("raw_text")
        if isinstance(rt, str) and rt.strip():
            return extract_telegram_n8n_text(rt)
    return str(raw).strip() if raw is not None else ""


def resolve_telegram_ai_style_hint(revision: str | None = None) -> str:
    base = DEFAULT_TELEGRAM_AI_STYLE_HINT
    extra = (revision or "").strip()
    if extra:
        return base + "\n\nДополнительные указания оператора (обязательно учти):\n" + extra
    return base


def request_telegram_ai_draft(
    db: Session,
    car: Car,
    *,
    revision: str | None = None,
    photo_ids: list[int] | None = None,
) -> tuple[bool, str, str]:
    """Тот же n8n webhook, что кнопка «Сгенерировать» в админке."""
    webhook_url = os.getenv("N8N_TELEGRAM_AI_WEBHOOK_URL")
    webhook_secret = os.getenv("N8N_TELEGRAM_AI_WEBHOOK_SECRET")
    timeout = float(os.getenv("N8N_TELEGRAM_AI_TIMEOUT_SEC", "120"))
    compose = build_social_compose(db, car)
    photos_sorted = list(compose.photos[:MAX_TELEGRAM_PHOTOS])
    if photo_ids:
        by_id = {p[0]: p for p in photos_sorted}
        photos_sorted = [by_id[pid] for pid in photo_ids if pid in by_id]
    photo_urls = [p[3] for p in photos_sorted if (p[3] or "").startswith("http")]
    slug_path = ""
    if compose.canonical_web_url:
        origin = _public_web_origin()
        slug_path = compose.canonical_web_url[len(origin) :] if compose.canonical_web_url.startswith(origin) else compose.canonical_path

    ok, body, err = n8n_webhook_post(
        url=webhook_url,
        secret=webhook_secret,
        payload={
            "event": "telegram_ai_draft",
            "car_id": car.id,
            "listing_web_url": compose.canonical_web_url,
            "canonical_path": slug_path or compose.canonical_path,
            "style_hint": resolve_telegram_ai_style_hint(revision),
            "selected_photo_absolute_urls": photo_urls,
            "car": {
                "title": compose.title,
                "description": compose.description,
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
                "rub_china_estimate": compose.rub_china,
                "estimated_total_rub": compose.estimated_total_rub,
            },
        },
        timeout_sec=timeout,
    )
    if not ok:
        return False, "", err or "Ошибка вызова n8n"
    text = extract_telegram_n8n_text(body)
    if not text:
        return False, "", "n8n вернул пустой текст. Ожидается JSON с полем «text»."
    return True, text, ""

