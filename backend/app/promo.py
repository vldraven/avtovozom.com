"""Публичное и админское API промоакций / баннеров."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session, joinedload

from .db import get_db
from .media_storage import save_promo_image
from .models import PromoCampaign, PromoPlacement, User
from .security import decode_access_token

MSK = timezone(timedelta(hours=3))

PLACEMENT_KEYS = (
    "home_hero",
    "catalog_sidebar",
    "catalog_feed",
    "blog_sidebar",
    "blog_feed",
)

PLACEMENT_LABELS = {
    "home_hero": "Главная · hero",
    "catalog_sidebar": "Каталог · сайдбар",
    "catalog_feed": "Каталог · лента (мобайл)",
    "blog_sidebar": "Блог · сайдбар",
    "blog_feed": "Блог · лента (мобайл)",
}

router = APIRouter(tags=["promo"])
_oauth_required = OAuth2PasswordBearer(tokenUrl="/auth/login")


def _user_from_token(db: Session, token: str | None) -> User | None:
    if not token:
        return None
    user_id = decode_access_token(token)
    if not user_id:
        return None
    user = (
        db.execute(
            select(User).where(User.id == int(user_id)).options(joinedload(User.role))
        )
        .unique()
        .scalar_one_or_none()
    )
    if not user or not user.is_active:
        return None
    return user


def get_current_user(
    token: str = Depends(_oauth_required), db: Session = Depends(get_db)
) -> User:
    user = _user_from_token(db, token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.role or user.role.code != "admin":
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return user


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class PromoPlacementIn(BaseModel):
    placement: str
    is_enabled: bool = True
    image_url: str = ""
    badge: str = ""
    title: str = ""
    subtitle: str = ""
    kicker: str = ""
    cta_label: str = ""


class PromoCampaignIn(BaseModel):
    slug: str = Field(min_length=2, max_length=64)
    name: str = ""
    is_enabled: bool = False
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    promo_code: str = ""
    accent_color: str = "#d9f43a"
    eyebrow: str = ""
    title_accent: str = ""
    title_rest: str = ""
    subtitle: str = ""
    cta_label: str = ""
    cta_path: str = "/request-quote"
    hero_image_url: str = ""
    placements: list[PromoPlacementIn] = Field(default_factory=list)


class PromoPlacementOut(BaseModel):
    id: int | None = None
    placement: str
    label: str = ""
    is_enabled: bool = True
    image_url: str = ""
    badge: str = ""
    title: str = ""
    subtitle: str = ""
    kicker: str = ""
    cta_label: str = ""


class PromoCampaignOut(BaseModel):
    id: int
    slug: str
    name: str
    is_enabled: bool
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    promo_code: str = ""
    accent_color: str = "#d9f43a"
    eyebrow: str = ""
    title_accent: str = ""
    title_rest: str = ""
    subtitle: str = ""
    cta_label: str = ""
    cta_path: str = "/request-quote"
    hero_image_url: str = ""
    cta_href: str = ""
    is_currently_active: bool = False
    placements: list[PromoPlacementOut] = Field(default_factory=list)


class PromoActiveOut(BaseModel):
    active: bool = False
    campaign: PromoCampaignOut | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _as_naive_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _campaign_in_window(camp: PromoCampaign, now: datetime | None = None) -> bool:
    now = now or _now_utc()
    starts = camp.starts_at
    ends = camp.ends_at
    if starts is not None and now < starts:
        return False
    if ends is not None and now > ends:
        return False
    return True


def _is_active(camp: PromoCampaign, now: datetime | None = None) -> bool:
    return bool(camp.is_enabled) and _campaign_in_window(camp, now)


def _cta_href(camp: PromoCampaign) -> str:
    path = (camp.cta_path or "/request-quote").strip() or "/request-quote"
    code = (camp.promo_code or "").strip()
    if not code:
        return path
    sep = "&" if "?" in path else "?"
    return f"{path}{sep}promo={code}"


def _placement_map(camp: PromoCampaign) -> dict[str, PromoPlacement]:
    return {p.placement: p for p in (camp.placements or [])}


def _ensure_placement_rows(db: Session, camp: PromoCampaign) -> None:
    existing = _placement_map(camp)
    dirty = False
    for key in PLACEMENT_KEYS:
        if key in existing:
            continue
        db.add(
            PromoPlacement(
                campaign_id=camp.id,
                placement=key,
                is_enabled=key != "home_hero" or True,
            )
        )
        dirty = True
    if dirty:
        db.flush()
        db.refresh(camp)
        # reload placements
        camp.placements = (
            db.execute(
                select(PromoPlacement).where(PromoPlacement.campaign_id == camp.id)
            )
            .scalars()
            .all()
        )


def _campaign_out(camp: PromoCampaign, now: datetime | None = None) -> PromoCampaignOut:
    now = now or _now_utc()
    by_key = _placement_map(camp)
    placements: list[PromoPlacementOut] = []
    for key in PLACEMENT_KEYS:
        row = by_key.get(key)
        placements.append(
            PromoPlacementOut(
                id=row.id if row else None,
                placement=key,
                label=PLACEMENT_LABELS.get(key, key),
                is_enabled=bool(row.is_enabled) if row else False,
                image_url=(row.image_url if row else "") or "",
                badge=(row.badge if row else "") or "",
                title=(row.title if row else "") or "",
                subtitle=(row.subtitle if row else "") or "",
                kicker=(row.kicker if row else "") or "",
                cta_label=(row.cta_label if row else "") or "",
            )
        )
    return PromoCampaignOut(
        id=camp.id,
        slug=camp.slug,
        name=camp.name or "",
        is_enabled=bool(camp.is_enabled),
        starts_at=camp.starts_at,
        ends_at=camp.ends_at,
        promo_code=camp.promo_code or "",
        accent_color=camp.accent_color or "#d9f43a",
        eyebrow=camp.eyebrow or "",
        title_accent=camp.title_accent or "",
        title_rest=camp.title_rest or "",
        subtitle=camp.subtitle or "",
        cta_label=camp.cta_label or "",
        cta_path=camp.cta_path or "/request-quote",
        hero_image_url=camp.hero_image_url or "",
        cta_href=_cta_href(camp),
        is_currently_active=_is_active(camp, now),
        placements=placements,
    )


def _public_active_payload(camp: PromoCampaign) -> dict[str, Any]:
    """Компактный payload для витрин: только включённые placements."""
    out = _campaign_out(camp)
    enabled = [p for p in out.placements if p.is_enabled]
    data = out.model_dump()
    data["placements"] = [p.model_dump() for p in enabled]
    data["placement_keys"] = [p.placement for p in enabled]
    return data


def get_active_campaign(db: Session, now: datetime | None = None) -> PromoCampaign | None:
    now = now or _now_utc()
    ensure_promo_seed(db)
    rows = (
        db.execute(
            select(PromoCampaign)
            .options(joinedload(PromoCampaign.placements))
            .where(PromoCampaign.is_enabled.is_(True))
            .order_by(PromoCampaign.id.desc())
        )
        .unique()
        .scalars()
        .all()
    )
    for camp in rows:
        if _is_active(camp, now):
            return camp
    return None


def ensure_promo_seed(db: Session) -> None:
    """Создаёт акцию ноября −30%, если таблицы пусты."""
    exists = db.execute(select(PromoCampaign.id).limit(1)).scalar_one_or_none()
    if exists is not None:
        return
    # 2026-11-01 00:00 MSK → 2026-10-31 21:00 UTC
    starts = datetime(2026, 10, 31, 21, 0, 0)
    ends = datetime(2026, 11, 30, 20, 59, 59)  # 30 Nov 23:59:59 MSK
    camp = PromoCampaign(
        slug="tg-30-nov-2026",
        name="−30% для подписчиков Telegram (ноябрь 2026)",
        is_enabled=True,
        starts_at=starts,
        ends_at=ends,
        promo_code="tg-30",
        accent_color="#d9f43a",
        eyebrow="Для подписчиков Telegram",
        title_accent="−30%",
        title_rest="на наши услуги\nдо 30 ноября",
        subtitle="Скидка на подбор, сопровождение сделки, таможенное оформление, получение СБКТС и ЭПТС.",
        cta_label="Оставить заявку со скидкой",
        cta_path="/request-quote",
        hero_image_url="/promo/hero-zeekr007-full.png",
    )
    db.add(camp)
    db.flush()
    defaults = {
        "home_hero": {"is_enabled": True, "image_url": "/promo/hero-zeekr007-full.png"},
        "catalog_sidebar": {
            "is_enabled": True,
            "image_url": "/promo/vw-troc.png",
            "badge": "−30%",
            "title": "на наши услуги до 30 ноября",
            "kicker": "Для подписчиков Telegram-канала",
            "cta_label": "Оставить заявку",
        },
        "catalog_feed": {
            "is_enabled": True,
            "image_url": "/promo/vw-troc.png",
            "badge": "−30%",
            "title": "на наши услуги до 30 ноября",
            "kicker": "Подписчикам Telegram",
            "cta_label": "Оставить заявку",
        },
        "blog_sidebar": {
            "is_enabled": True,
            "image_url": "/promo/zeekr.png",
            "badge": "−30%",
            "title": "на наши услуги до 30 ноября",
            "kicker": "Для подписчиков Telegram-канала",
            "cta_label": "Оставить заявку",
        },
        "blog_feed": {
            "is_enabled": True,
            "image_url": "/promo/zeekr.png",
            "badge": "−30%",
            "title": "на наши услуги до 30 ноября",
            "kicker": "Подписчикам Telegram",
            "cta_label": "Оставить заявку",
        },
    }
    for key in PLACEMENT_KEYS:
        conf = defaults.get(key, {})
        db.add(
            PromoPlacement(
                campaign_id=camp.id,
                placement=key,
                is_enabled=bool(conf.get("is_enabled", True)),
                image_url=conf.get("image_url", ""),
                badge=conf.get("badge", ""),
                title=conf.get("title", ""),
                subtitle=conf.get("subtitle", ""),
                kicker=conf.get("kicker", ""),
                cta_label=conf.get("cta_label", ""),
            )
        )
    db.commit()


def _disable_other_campaigns(db: Session, keep_id: int) -> None:
    db.execute(
        update(PromoCampaign)
        .where(PromoCampaign.id != keep_id)
        .values(is_enabled=False, updated_at=_now_utc())
    )


def _apply_campaign_fields(camp: PromoCampaign, payload: PromoCampaignIn) -> None:
    camp.slug = payload.slug.strip()[:64]
    camp.name = (payload.name or "").strip()[:160]
    camp.starts_at = _as_naive_utc(payload.starts_at)
    camp.ends_at = _as_naive_utc(payload.ends_at)
    camp.promo_code = (payload.promo_code or "").strip()[:64]
    camp.accent_color = (payload.accent_color or "#d9f43a").strip()[:16] or "#d9f43a"
    camp.eyebrow = (payload.eyebrow or "").strip()[:160]
    camp.title_accent = (payload.title_accent or "").strip()[:64]
    camp.title_rest = (payload.title_rest or "").strip()[:240]
    camp.subtitle = (payload.subtitle or "").strip()
    camp.cta_label = (payload.cta_label or "").strip()[:120]
    camp.cta_path = (payload.cta_path or "/request-quote").strip()[:240] or "/request-quote"
    camp.hero_image_url = (payload.hero_image_url or "").strip()[:512]
    camp.updated_at = _now_utc()


def _upsert_placements(db: Session, camp: PromoCampaign, rows: list[PromoPlacementIn]) -> None:
    by_key = _placement_map(camp)
    incoming = {r.placement: r for r in rows if r.placement in PLACEMENT_KEYS}
    for key in PLACEMENT_KEYS:
        payload = incoming.get(key)
        row = by_key.get(key)
        if row is None:
            row = PromoPlacement(campaign_id=camp.id, placement=key)
            db.add(row)
            by_key[key] = row
        if payload is None:
            continue
        row.is_enabled = bool(payload.is_enabled)
        row.image_url = (payload.image_url or "").strip()[:512]
        row.badge = (payload.badge or "").strip()[:64]
        row.title = (payload.title or "").strip()[:240]
        row.subtitle = (payload.subtitle or "").strip()[:320]
        row.kicker = (payload.kicker or "").strip()[:160]
        row.cta_label = (payload.cta_label or "").strip()[:120]
        row.updated_at = _now_utc()


def _load_campaign(db: Session, campaign_id: int) -> PromoCampaign:
    camp = db.execute(
        select(PromoCampaign)
        .options(joinedload(PromoCampaign.placements))
        .where(PromoCampaign.id == campaign_id)
    ).unique().scalar_one_or_none()
    if not camp:
        raise HTTPException(status_code=404, detail="Акция не найдена")
    return camp


# ---------------------------------------------------------------------------
# Public
# ---------------------------------------------------------------------------


@router.get("/promo/active")
def public_active_promo(db: Session = Depends(get_db)):
    camp = get_active_campaign(db)
    if not camp:
        return {"active": False, "campaign": None}
    return {"active": True, "campaign": _public_active_payload(camp)}


@router.get("/promo/meta")
def public_promo_meta():
    return {
        "placements": [
            {"key": key, "label": PLACEMENT_LABELS[key]} for key in PLACEMENT_KEYS
        ]
    }


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------


@router.get("/admin/promo/campaigns", response_model=list[PromoCampaignOut])
def admin_list_campaigns(
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    del user
    ensure_promo_seed(db)
    rows = (
        db.execute(
            select(PromoCampaign)
            .options(joinedload(PromoCampaign.placements))
            .order_by(PromoCampaign.id.desc())
        )
        .unique()
        .scalars()
        .all()
    )
    now = _now_utc()
    return [_campaign_out(c, now) for c in rows]


@router.post("/admin/promo/campaigns", response_model=PromoCampaignOut)
def admin_create_campaign(
    payload: PromoCampaignIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    del user
    slug = payload.slug.strip()[:64]
    if not slug:
        raise HTTPException(status_code=400, detail="Укажите slug")
    exists = db.execute(select(PromoCampaign).where(PromoCampaign.slug == slug)).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=400, detail="Slug уже занят")
    camp = PromoCampaign(slug=slug)
    _apply_campaign_fields(camp, payload)
    camp.is_enabled = False
    db.add(camp)
    db.flush()
    _upsert_placements(db, camp, payload.placements or [])
    if payload.is_enabled:
        _disable_other_campaigns(db, camp.id)
        camp.is_enabled = True
    db.commit()
    return _campaign_out(_load_campaign(db, camp.id))


@router.get("/admin/promo/campaigns/{campaign_id}", response_model=PromoCampaignOut)
def admin_get_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    del user
    return _campaign_out(_load_campaign(db, campaign_id))


@router.put("/admin/promo/campaigns/{campaign_id}", response_model=PromoCampaignOut)
def admin_update_campaign(
    campaign_id: int,
    payload: PromoCampaignIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    del user
    camp = _load_campaign(db, campaign_id)
    slug = payload.slug.strip()[:64]
    if slug != camp.slug:
        clash = db.execute(
            select(PromoCampaign).where(PromoCampaign.slug == slug, PromoCampaign.id != camp.id)
        ).scalar_one_or_none()
        if clash:
            raise HTTPException(status_code=400, detail="Slug уже занят")
    _apply_campaign_fields(camp, payload)
    _upsert_placements(db, camp, payload.placements or [])
    if payload.is_enabled:
        _disable_other_campaigns(db, camp.id)
        camp.is_enabled = True
    else:
        camp.is_enabled = False
    db.commit()
    return _campaign_out(_load_campaign(db, camp.id))


@router.post("/admin/promo/campaigns/{campaign_id}/enable", response_model=PromoCampaignOut)
def admin_enable_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    del user
    camp = _load_campaign(db, campaign_id)
    _disable_other_campaigns(db, camp.id)
    camp.is_enabled = True
    camp.updated_at = _now_utc()
    db.commit()
    return _campaign_out(_load_campaign(db, camp.id))


@router.post("/admin/promo/campaigns/{campaign_id}/disable", response_model=PromoCampaignOut)
def admin_disable_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    del user
    camp = _load_campaign(db, campaign_id)
    camp.is_enabled = False
    camp.updated_at = _now_utc()
    db.commit()
    return _campaign_out(_load_campaign(db, camp.id))


@router.delete("/admin/promo/campaigns/{campaign_id}")
def admin_delete_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    del user
    camp = _load_campaign(db, campaign_id)
    db.delete(camp)
    db.commit()
    return {"ok": True}


@router.post("/admin/promo/campaigns/{campaign_id}/upload")
async def admin_upload_promo_image(
    campaign_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    del user
    _load_campaign(db, campaign_id)
    data = await file.read()
    try:
        url = save_promo_image(campaign_id, data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"url": url}
