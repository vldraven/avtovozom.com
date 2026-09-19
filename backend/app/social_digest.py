"""Дайджест новых поступлений для Telegram / MAX."""

from __future__ import annotations

import os
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from .catalog_slug import build_catalog_slug_maps, slugs_for_car
from .listing_compose import build_listing_marketing_compose
from .max_client import MaxApiError, publish_listing_to_channel
from .models import Car
from .n8n_client import n8n_webhook_post
from .social_publish import (
    extract_telegram_n8n_text,
    publish_telegram_via_n8n,
)

try:
    MSK = ZoneInfo("Europe/Moscow")
except Exception:  # pragma: no cover
    MSK = timezone(timedelta(hours=3))

# Лимит фото/лотов в одном посте (альбом Telegram / MAX).
MAX_DIGEST_CARS = 10
# Сколько объявлений максимум показать в админке за период (отбор вручную).
MAX_DIGEST_LIST = 200

DEFAULT_DIGEST_AI_STYLE_HINT = (
    "Ты редактор Telegram/MAX-канала avtovozom.com (доставка авто из Китая).\n"
    "По JSON со списком новых объявлений собери ОДИН пост-дайджест.\n\n"
    "Структура строго:\n"
    "1) Короткое яркое вступление (1–3 предложения) — «описание подборки».\n"
    "2) Для КАЖДОГО авто блок:\n"
    "   • Заголовок: эмодзи + марка/модель/год — ≈ цена в млн ₽ (как в facts).\n"
    "   • Строка характеристик: пробег · объём · л.с. (только из facts).\n"
    "   • 1–2 предложения sales-описания модели (можно общие тезисы по модели).\n"
    "   • Ссылка listing_web_url с новой строки.\n"
    "   • Пустая строка между авто.\n"
    "3) Короткое заключение с призывом смотреть каталог / писать @avtovozombot.\n\n"
    "Правила:\n"
    "- Не выдумывай цены, год, пробег, мощность — только из JSON.\n"
    "- Не вставляй фото и markdown-картинки.\n"
    "- Без заголовков вроде «Ответ модели».\n"
    "- Соблюдай дополнительные указания оператора, если переданы."
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


def parse_msk_date(value: str | date | None, *, end_of_day: bool = False) -> datetime | None:
    """YYYY-MM-DD (МСК) → naive UTC datetime для сравнения с Car.created_at."""
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        d = value
    else:
        s = str(value).strip()
        if not s:
            return None
        d = date.fromisoformat(s[:10])
    t = time.max.replace(microsecond=0) if end_of_day else time.min
    local = datetime.combine(d, t, tzinfo=MSK)
    return local.astimezone(timezone.utc).replace(tzinfo=None)


def _format_price_mln(rub: float | None) -> str:
    if rub is None or rub <= 0:
        return "цена по запросу"
    mln = rub / 1_000_000
    if mln >= 10:
        return f"≈ {mln:.1f}".replace(".", ",") + " млн ₽"
    return f"≈ {mln:.2f}".replace(".", ",") + " млн ₽"


def _format_km(mileage: int | None) -> str | None:
    if mileage is None:
        return None
    return f"{int(mileage):,}".replace(",", " ") + " км"


def _format_engine_l(cc: int | None) -> str | None:
    if not cc or cc <= 0:
        return None
    return f"{cc / 1000:.1f}".rstrip("0").rstrip(".")


def _cover_photo(car: Car) -> tuple[int | None, str, str]:
    photos = sorted(
        list(car.photos or []),
        key=lambda p: (p.sort_order if p.sort_order is not None else 0, p.id),
    )
    if not photos:
        return None, "", ""
    p = photos[0]
    return p.id, p.storage_url or "", _absolute_public_asset_url(p.storage_url or "")


def _canonical_url(car: Car, slug_maps: Any) -> str:
    brand_slug, model_slug = slugs_for_car(car, slug_maps[0], slug_maps[1])
    if brand_slug and model_slug:
        path = f"/catalog/{brand_slug}/{model_slug}/{car.id}"
    else:
        path = f"/cars/{car.id}"
    return f"{_public_web_origin()}{path}"


def list_new_cars_for_digest(
    db: Session,
    *,
    date_from: str | date | None,
    date_to: str | date | None,
) -> list[Car]:
    start = parse_msk_date(date_from, end_of_day=False)
    end = parse_msk_date(date_to, end_of_day=True)
    if start is None:
        # по умолчанию — последние 7 дней МСК
        today = datetime.now(MSK).date()
        start = parse_msk_date(today - timedelta(days=6), end_of_day=False)
    if end is None:
        end = parse_msk_date(datetime.now(MSK).date(), end_of_day=True)

    q = (
        select(Car)
        .options(
            joinedload(Car.brand),
            joinedload(Car.model),
            joinedload(Car.generation),
            joinedload(Car.photos),
        )
        .where(Car.is_active.is_(True))
        .where(Car.created_at >= start)
        .where(Car.created_at <= end)
        .order_by(Car.created_at.desc(), Car.id.desc())
        .limit(MAX_DIGEST_LIST)
    )
    return list(db.execute(q).unique().scalars().all())


def car_to_digest_item(
    db: Session,
    car: Car,
    *,
    slug_maps: Any = None,
) -> dict[str, Any]:
    maps = slug_maps or build_catalog_slug_maps(db)
    price = float(car.estimated_total_rub) if car.estimated_total_rub is not None else None
    compose = build_listing_marketing_compose(
        car,
        public_web_origin=_public_web_origin(),
        slug_maps=maps,
        absolute_url_fn=_absolute_public_asset_url,
        rub_china=None,
        estimated_total_rub=price,
    )
    photo_id, storage_url, absolute_url = _cover_photo(car)
    created = car.created_at
    created_msk = ""
    if created:
        if created.tzinfo is None:
            created_utc = created.replace(tzinfo=timezone.utc)
        else:
            created_utc = created
        created_msk = created_utc.astimezone(MSK).strftime("%Y-%m-%d %H:%M")

    bits: list[str] = []
    km = _format_km(car.mileage_km)
    if km:
        bits.append(km)
    eng = _format_engine_l(car.engine_volume_cc)
    if eng:
        bits.append(eng)
    if car.horsepower and car.horsepower > 0:
        bits.append(f"{int(car.horsepower)} л.с.")

    title = (compose.title or f"{compose.brand} {compose.model} {compose.year}").strip()
    return {
        "car_id": car.id,
        "title": title,
        "brand": compose.brand,
        "model": compose.model,
        "year": compose.year,
        "mileage_km": car.mileage_km,
        "engine_volume_cc": car.engine_volume_cc,
        "horsepower": car.horsepower,
        "fuel_type": compose.fuel_type,
        "transmission": compose.transmission,
        "estimated_total_rub": price,
        "price_label": _format_price_mln(price),
        "specs_line": " · ".join(bits),
        "listing_web_url": compose.canonical_web_url or _canonical_url(car, maps),
        "cover_photo_id": photo_id,
        "cover_storage_url": storage_url,
        "cover_absolute_url": absolute_url,
        "created_at_msk": created_msk,
        "blurb": "",  # заполняет ИИ; в skeleton — короткий шаблон
    }


def build_digest_skeleton(items: list[dict[str, Any]], *, period_label: str) -> str:
    lines: list[str] = [
        f"🆕 Новые поступления на avtovozom.com ({period_label})",
        "",
        "Подборка свежих авто из Китая под ключ — с растаможкой и доставкой до Москвы.",
        "",
    ]
    for it in items:
        emoji = "🚗"
        lines.append(f"{emoji} {it['title']} — {it['price_label']}")
        lines.append("")
        if it.get("specs_line"):
            lines.append(str(it["specs_line"]))
            lines.append("")
        brand = it.get("brand") or "модель"
        lines.append(
            f"Компактный обзор: {brand} в нашей витрине — подробности комплектации и расчёт "
            f"доставки до вашего города на сайте."
        )
        lines.append("")
        lines.append(str(it.get("listing_web_url") or ""))
        lines.append("")
    lines.append(
        "Смотрите весь каталог на сайте или напишите нам: @avtovozombot — подберём авто под бюджет."
    )
    return "\n".join(lines).strip()


def period_label(date_from: str | None, date_to: str | None) -> str:
    today = datetime.now(MSK).date().isoformat()
    df = (date_from or "").strip() or today
    dt = (date_to or "").strip() or today
    if df == dt:
        return df
    return f"{df} — {dt}"


def compose_digest(
    db: Session,
    *,
    date_from: str | None,
    date_to: str | None,
    car_ids: list[int] | None = None,
) -> dict[str, Any]:
    slug_maps = build_catalog_slug_maps(db)
    if car_ids:
        cars = (
            db.execute(
                select(Car)
                .options(
                    joinedload(Car.brand),
                    joinedload(Car.model),
                    joinedload(Car.generation),
                    joinedload(Car.photos),
                )
                .where(Car.id.in_(car_ids), Car.is_active.is_(True))
            )
            .unique()
            .scalars()
            .all()
        )
        by_id = {c.id: c for c in cars}
        # Для текста/публикации — не больше альбома; порядок как в запросе.
        ordered = [by_id[i] for i in car_ids if i in by_id][:MAX_DIGEST_CARS]
        build_skeleton = True
    else:
        # Список за период целиком (с защитным потолком) — отбор вручную в админке.
        ordered = list_new_cars_for_digest(db, date_from=date_from, date_to=date_to)
        build_skeleton = False

    items = [car_to_digest_item(db, c, slug_maps=slug_maps) for c in ordered]
    label = period_label(date_from, date_to)
    skeleton = build_digest_skeleton(items, period_label=label) if build_skeleton else ""
    cover_urls = [it["cover_absolute_url"] for it in items if it.get("cover_absolute_url")]
    return {
        "date_from": (date_from or "").strip() or None,
        "date_to": (date_to or "").strip() or None,
        "period_label": label,
        "count": len(items),
        "items": items,
        "skeleton_text": skeleton,
        "cover_photo_urls": cover_urls[:MAX_DIGEST_CARS],
        "max_cars": MAX_DIGEST_CARS,
        "max_list": MAX_DIGEST_LIST,
    }


def resolve_digest_ai_style_hint(revision: str | None = None) -> str:
    base = DEFAULT_DIGEST_AI_STYLE_HINT
    extra = (revision or "").strip()
    if extra:
        return base + "\n\nДополнительные указания оператора:\n" + extra
    return base


def request_digest_ai_draft(
    *,
    compose: dict[str, Any],
    revision: str | None = None,
) -> tuple[bool, str, str]:
    """Вызов n8n: отдельный webhook дайджеста или fallback на telegram AI webhook."""
    webhook_url = (
        (os.getenv("N8N_DIGEST_AI_WEBHOOK_URL") or "").strip()
        or (os.getenv("N8N_TELEGRAM_AI_WEBHOOK_URL") or "").strip()
    )
    webhook_secret = (
        (os.getenv("N8N_DIGEST_AI_WEBHOOK_SECRET") or "").strip()
        or (os.getenv("N8N_TELEGRAM_AI_WEBHOOK_SECRET") or "").strip()
    )
    timeout = float(os.getenv("N8N_DIGEST_AI_TIMEOUT_SEC") or os.getenv("N8N_TELEGRAM_AI_TIMEOUT_SEC") or "180")
    if not webhook_url:
        return False, "", "Не задан N8N_DIGEST_AI_WEBHOOK_URL / N8N_TELEGRAM_AI_WEBHOOK_URL"

    ok, body, err = n8n_webhook_post(
        url=webhook_url,
        secret=webhook_secret,
        payload={
            "event": "social_digest_ai_draft",
            "style_hint": resolve_digest_ai_style_hint(revision),
            "period_label": compose.get("period_label"),
            "skeleton_text": compose.get("skeleton_text"),
            "cars": [
                {
                    "car_id": it["car_id"],
                    "title": it["title"],
                    "brand": it["brand"],
                    "model": it["model"],
                    "year": it["year"],
                    "mileage_km": it["mileage_km"],
                    "engine_volume_cc": it["engine_volume_cc"],
                    "horsepower": it["horsepower"],
                    "estimated_total_rub": it["estimated_total_rub"],
                    "price_label": it["price_label"],
                    "specs_line": it["specs_line"],
                    "listing_web_url": it["listing_web_url"],
                }
                for it in compose.get("items") or []
            ],
            "cover_photo_urls": compose.get("cover_photo_urls") or [],
        },
        timeout_sec=timeout,
    )
    if not ok:
        return False, "", err or "Ошибка вызова n8n"
    text = extract_telegram_n8n_text(body)
    if not text:
        return False, "", "n8n вернул пустой текст. Ожидается JSON с полем «text»."
    return True, text, ""


def publish_digest(
    *,
    text: str,
    photo_urls: list[str],
    channel_tg: bool = True,
    channel_max: bool = True,
) -> dict[str, Any]:
    text = (text or "").strip()
    if not text:
        return {"ok": False, "detail": "Пустой текст дайджеста", "parts": []}
    urls = [u for u in photo_urls if (u or "").strip()][:MAX_DIGEST_CARS]
    if not channel_tg and not channel_max:
        return {"ok": False, "detail": "Выберите Telegram и/или MAX", "parts": []}

    parts: list[str] = []
    failed = False

    if channel_tg:
        ok, _data, err = publish_telegram_via_n8n(
            car_id=0,
            listing_web_url=_public_web_origin(),
            text=text,
            photo_urls=urls,
        )
        if ok:
            parts.append("Telegram: ок")
        else:
            failed = True
            parts.append(f"Telegram: {err or 'ошибка'}")

    if channel_max:
        try:
            result = publish_listing_to_channel(
                message=text,
                photo_urls=urls,
                listing_web_url=_public_web_origin(),
            )
            url = result.post_url or ""
            parts.append(f"MAX: ок{f' ({url})' if url else ''}")
        except MaxApiError as exc:
            failed = True
            parts.append(f"MAX: {exc}")
        except Exception as exc:
            failed = True
            parts.append(f"MAX: {exc}")

    return {
        "ok": not failed,
        "detail": " · ".join(parts),
        "parts": parts,
    }
