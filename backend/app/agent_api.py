"""Agent API: capabilities сайта для внешнего sourcing-агента (n8n).

Auth: header X-Agent-Secret == AGENT_API_SECRET.
LLM / Telegram / search — снаружи; здесь только данные и che168 discover.
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from datetime import date, datetime, time as dt_time, timedelta, timezone
from typing import Any, Literal
from urllib.parse import urlparse, urlunparse
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, joinedload

from .catalog_resolve import (
    ensure_candidate_catalog,
    lookup_model_with_brand,
    resolve_catalog,
)
from .che168_parser import (
    ListingCard,
    che168_proxy_url,
    horsepower_from_carinfo_url,
    marketplace_from_detail_url,
    normalize_import_detail_url,
    parse_che168_detail,
    parse_che168_listing_cards_many,
    source_listing_id_from_url,
)
from .db import get_db
from .import_plan_logic import (
    ensure_import_plan,
    request_stop_import_plan,
    start_import_plan,
)
from .models import (
    AgentMemory,
    Car,
    CarBrand,
    CarModel,
    ImportCandidate,
    ImportPlanItem,
    ModelWhitelist,
    SearchProfile,
    SourcingApprovalSession,
)
from .sourcing_defaults import DEFAULT_SOURCING_SERIES_URLS

logger = logging.getLogger(__name__)

AGENT_API_SECRET_ENV = "AGENT_API_SECRET"
AGENT_SECRET_HEADER = "X-Agent-Secret"

router = APIRouter(prefix="/agent/v1", tags=["agent"])

try:
    MSK = ZoneInfo("Europe/Moscow")
except Exception:  # pragma: no cover
    MSK = timezone(timedelta(hours=3))


def verify_agent_secret(
    x_agent_secret: str | None = Header(default=None, alias=AGENT_SECRET_HEADER),
) -> None:
    expected = (os.getenv(AGENT_API_SECRET_ENV) or "").strip()
    if not expected:
        raise HTTPException(
            status_code=503,
            detail="AGENT_API_SECRET не настроен на сервере",
        )
    got = (x_agent_secret or "").strip()
    if got != expected:
        raise HTTPException(status_code=403, detail="Forbidden")


# ---- schemas ----


class SearchProfileOut(BaseModel):
    id: int
    name: str
    enabled: bool
    criteria: dict[str, Any] = Field(default_factory=dict)
    brief: str = ""
    max_select: int = 20
    created_at: datetime | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True


class SearchProfileUpdateIn(BaseModel):
    name: str | None = None
    enabled: bool | None = None
    criteria: dict[str, Any] | None = None
    brief: str | None = None
    max_select: int | None = Field(default=None, ge=1, le=100)


class QuotaOut(BaseModel):
    profile_id: int
    max_select: int
    already_today: int
    needed: int
    day: str  # YYYY-MM-DD MSK


class ImportCandidateOut(BaseModel):
    id: int
    profile_id: int
    url: str
    listing_id: str
    marketplace: str
    brand_id: int | None = None
    brand_name: str = ""
    model_id: int | None = None
    model_name: str = ""
    generation_id: int | None = None
    generation_name: str = ""
    year: int | None = None
    price_cny: float | None = None
    mileage_km: int | None = None
    horsepower: int | None = None
    registration_date: str | None = None
    title: str = ""
    score: float | None = None
    reasons: list[Any] = Field(default_factory=list)
    status: str
    filter_reasons: list[Any] = Field(default_factory=list)
    selected_at: datetime | None = None
    created_at: datetime | None = None

    class Config:
        from_attributes = True


class DiscoverIn(BaseModel):
    profile_id: int | None = None
    series_urls: list[str] = Field(default_factory=list)
    model_ids: list[int] = Field(default_factory=list)
    limit_per_series: int = Field(default=40, ge=1, le=100)
    max_created: int | None = Field(default=None, ge=1, le=500)
    """Остановиться, когда набрано столько новых URL. None = все витрины (лимит только per series)."""
    use_whitelist: bool = False
    """Whitelist сайта — НЕ источник discover. Только criteria.series_urls / явный список."""


class DiscoverOut(BaseModel):
    created: int
    skipped_existing: int
    candidates: list[ImportCandidateOut]
    series_ok: int = 0
    series_failed: int = 0
    series_errors: list[str] = Field(default_factory=list)


class EnrichIn(BaseModel):
    profile_id: int
    candidate_ids: list[int] | None = None
    limit: int = Field(default=30, ge=1, le=80)
    only_missing: bool = True
    """Если true — обогащать только карточки без year/price/mileage."""
    budget_sec: float | None = Field(default=None, ge=5, le=300)


class EnrichOut(BaseModel):
    enriched: int
    failed: int
    candidates: list[ImportCandidateOut]


class FilterIn(BaseModel):
    profile_id: int
    candidate_ids: list[int] | None = None
    overlay_criteria: dict[str, Any] | None = None


class FilterOut(BaseModel):
    passed: list[ImportCandidateOut]
    rejected: list[ImportCandidateOut]


class CompactListingOut(BaseModel):
    """Компактная строка для LLM-shortlist."""

    id: int
    brand: str = ""
    model: str = ""
    year: int | None = None
    mileage_km: int | None = None
    price_cny: float | None = None
    horsepower: int | None = None
    url: str = ""


class MarketResearchOut(BaseModel):
    profile_id: int
    market_research_at: str | None = None
    market_hot_models: list[str] = Field(default_factory=list)
    stale: bool = True
    max_age_days: int = 7


class MarketResearchIn(BaseModel):
    market_hot_models: list[str] = Field(default_factory=list)
    market_research_at: str | None = None
    """ISO date YYYY-MM-DD; если пусто — сегодня (MSK)."""


class CollectIn(BaseModel):
    profile_id: int
    parse_limit: int = Field(default=300, ge=1, le=500)
    """Сколько ссылок максимум собрать (сумма по series)."""
    limit_per_series: int = Field(default=30, ge=1, le=100)
    filter_limit: int = Field(default=200, ge=1, le=500)
    """Сколько прошедших hard-filter вернуть в shortlist_pool."""
    llm_shortlist_limit: int = Field(default=200, ge=1, le=400)
    discover_retries: int = Field(default=1, ge=1, le=5)
    discover_retry_pause_sec: float = Field(default=15.0, ge=0, le=300)
    market_research_max_age_days: int = Field(default=7, ge=1, le=90)


class CollectOut(BaseModel):
    status: Literal["ok", "empty", "quota_closed", "error"]
    message: str = ""
    profile_id: int
    needed: int = 0
    already_today: int = 0
    discover_attempts: int = 0
    created: int = 0
    enriched: int = 0
    enrich_failed: int = 0
    passed: int = 0
    rejected: int = 0
    series_ok: int = 0
    series_failed: int = 0
    series_errors: list[str] = Field(default_factory=list)
    listings: list[CompactListingOut] = Field(default_factory=list)
    """Компактный пул для LLM (до llm_shortlist_limit)."""
    market_research: MarketResearchOut | None = None


class ScoreItemIn(BaseModel):
    id: int
    score: float = Field(..., ge=0, le=100)
    reasons: list[str] = Field(default_factory=list)
    year: int | None = None
    price_cny: float | None = None
    mileage_km: int | None = None
    registration_date: str | None = None
    title: str | None = None
    brand_name: str | None = None
    model_name: str | None = None


class ScoreIn(BaseModel):
    items: list[ScoreItemIn]


class ApplyIn(BaseModel):
    profile_id: int
    min_score: float | None = None
    limit: int | None = Field(default=None, ge=1, le=100)
    candidate_ids: list[int] | None = None
    replace_plan: bool = True
    """По умолчанию заменить план сегодняшним отбором агента (не смешивать с ручными success)."""


class ApplyOut(BaseModel):
    applied: int
    needed: int
    already_today: int
    plan_rows: int
    candidates: list[ImportCandidateOut]
    skipped_missing_model: int = 0


class MemoryOut(BaseModel):
    id: int
    agent_key: str
    kind: str
    content: str
    source: str
    created_at: datetime | None = None

    class Config:
        from_attributes = True


class MemoryCreateIn(BaseModel):
    agent_key: str = "sourcing"
    kind: Literal["lesson", "preference", "ban", "market_note"] = "lesson"
    content: str = Field(..., min_length=1, max_length=8000)
    source: Literal["tg_revise", "tg_cancel", "manual", "run"] = "manual"


class ApprovalSessionCreateIn(BaseModel):
    profile_id: int
    candidate_ids: list[int] = Field(default_factory=list)
    telegram_chat_id: str = ""
    telegram_message_id: str = ""
    summary: str = ""


class ApprovalSessionPatchIn(BaseModel):
    status: Literal["pending", "approved", "cancelled", "expired"] | None = None
    telegram_chat_id: str | None = None
    telegram_message_id: str | None = None
    summary: str | None = None
    candidate_ids: list[int] | None = None


class ApprovalSessionOut(BaseModel):
    id: int
    profile_id: int
    status: str
    candidate_ids: list[Any] = Field(default_factory=list)
    telegram_chat_id: str = ""
    telegram_message_id: str = ""
    summary: str = ""
    created_at: datetime | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True


class ImportPlanAgentItemOut(BaseModel):
    id: int
    client_key: str
    marketplace: str
    brand_name: str
    model_name: str
    url: str
    status: str
    attempts: int
    message: str


class ImportPlanAgentOut(BaseModel):
    status: str
    running: bool
    banner: str
    error: str
    updated_at: datetime | None = None
    rows: list[ImportPlanAgentItemOut]


# ---- helpers ----


def _msk_today() -> date:
    return datetime.now(MSK).date()


def _msk_day_bounds_utc(day: date | None = None) -> tuple[datetime, datetime]:
    d = day or _msk_today()
    start_local = datetime.combine(d, dt_time.min, tzinfo=MSK)
    end_local = start_local + timedelta(days=1)
    return (
        start_local.astimezone(timezone.utc).replace(tzinfo=None),
        end_local.astimezone(timezone.utc).replace(tzinfo=None),
    )


def _candidate_out(c: ImportCandidate) -> ImportCandidateOut:
    return ImportCandidateOut.model_validate(c)


def _get_profile(db: Session, profile_id: int) -> SearchProfile:
    profile = db.get(SearchProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="search profile not found")
    return profile


def count_already_today(db: Session, profile_id: int, day: date | None = None) -> int:
    """Сколько кандидатов уже отобрано/импортировано за день (MSK)."""
    start, end = _msk_day_bounds_utc(day)
    return int(
        db.execute(
            select(func.count())
            .select_from(ImportCandidate)
            .where(
                ImportCandidate.profile_id == profile_id,
                ImportCandidate.status.in_(("selected", "imported")),
                ImportCandidate.selected_at.isnot(None),
                ImportCandidate.selected_at >= start,
                ImportCandidate.selected_at < end,
            )
        ).scalar_one()
        or 0
    )


def quota_for_profile(db: Session, profile: SearchProfile) -> QuotaOut:
    day = _msk_today()
    already = count_already_today(db, profile.id, day)
    max_select = max(0, int(profile.max_select or 0))
    needed = max(0, max_select - already)
    return QuotaOut(
        profile_id=profile.id,
        max_select=max_select,
        already_today=already,
        needed=needed,
        day=day.isoformat(),
    )


def _parse_iso_date(raw: str | None) -> date | None:
    s = (raw or "").strip()
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def market_research_for_profile(
    profile: SearchProfile,
    *,
    max_age_days: int = 7,
) -> MarketResearchOut:
    criteria = profile.criteria or {}
    at_raw = criteria.get("market_research_at")
    at = _parse_iso_date(str(at_raw) if at_raw is not None else None)
    hot_raw = criteria.get("market_hot_models")
    hot: list[str] = []
    if isinstance(hot_raw, list):
        hot = [str(x).strip() for x in hot_raw if str(x).strip()][:40]
    elif isinstance(hot_raw, str) and hot_raw.strip():
        hot = [p.strip() for p in hot_raw.split(",") if p.strip()][:40]
    stale = True
    if at is not None:
        stale = (_msk_today() - at).days >= max(1, int(max_age_days))
    return MarketResearchOut(
        profile_id=profile.id,
        market_research_at=at.isoformat() if at else None,
        market_hot_models=hot,
        stale=stale,
        max_age_days=max(1, int(max_age_days)),
    )


def _compact_listing(c: ImportCandidate) -> CompactListingOut:
    return CompactListingOut(
        id=c.id,
        brand=(c.brand_name or "")[:64],
        model=(c.model_name or "")[:64],
        year=c.year,
        mileage_km=c.mileage_km,
        price_cny=float(c.price_cny) if c.price_cny is not None else None,
        horsepower=int(c.horsepower) if getattr(c, "horsepower", None) else None,
        url=(c.url or "")[:512],
    )


def _merge_criteria(
    base: dict[str, Any] | None, overlay: dict[str, Any] | None
) -> dict[str, Any]:
    out = dict(base or {})
    if overlay:
        out.update(overlay)
    return out


def normalize_series_url(url: str) -> str:
    """Убирает query/hash, нормализует trailing slash."""
    raw = (url or "").strip()
    if not raw:
        return ""
    try:
        p = urlparse(raw)
    except Exception:
        return raw.split("?")[0].split("#")[0].strip()
    if not p.netloc and not p.path:
        return ""
    scheme = p.scheme or "https"
    netloc = p.netloc or "www.che168.com"
    path = p.path or "/"
    if not path.endswith("/"):
        path = f"{path}/"
    return urlunparse((scheme, netloc, path, "", "", ""))


def _coerce_positive_id(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def parse_series_url_item(raw: Any) -> tuple[str, int | None, int | None]:
    """Элемент criteria.series_urls: строка или {url, brand_id, model_id}."""
    if isinstance(raw, dict):
        url = normalize_series_url(str(raw.get("url") or raw.get("series_url") or ""))
        return url, _coerce_positive_id(raw.get("brand_id")), _coerce_positive_id(raw.get("model_id"))
    return normalize_series_url(str(raw or "")), None, None


def series_url_entries_from_payload(raw_urls: Any) -> list[dict[str, Any]]:
    """Нормализует список витрин: уникальный url + опциональные brand_id/model_id."""
    if isinstance(raw_urls, str):
        raw_list: list[Any] = [ln.strip() for ln in raw_urls.splitlines() if ln.strip()]
    elif isinstance(raw_urls, list):
        raw_list = list(raw_urls)
    else:
        raise ValueError("series_urls must be list or text")
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for item in raw_list:
        url, brand_id, model_id = parse_series_url_item(item)
        if not url or url in seen:
            continue
        seen.add(url)
        entry: dict[str, Any] = {"url": url}
        if brand_id:
            entry["brand_id"] = brand_id
        if model_id:
            entry["model_id"] = model_id
        out.append(entry)
    return out


def _registration_age_years(reg: str | None, *, today: date | None = None) -> float | None:
    """Возраст по registration_date (YYYY-MM-DD или YYYY-MM)."""
    s = (reg or "").strip()
    if not s:
        return None
    parts = s.split("-")
    try:
        y = int(parts[0])
        m = int(parts[1]) if len(parts) > 1 else 1
        d = int(parts[2]) if len(parts) > 2 else 1
        reg_d = date(y, m, d)
    except (TypeError, ValueError):
        return None
    ref = today or _msk_today()
    days = (ref - reg_d).days
    if days < 0:
        return 0.0
    return days / 365.25


def hard_filter_candidate(
    c: ImportCandidate,
    criteria: dict[str, Any],
    *,
    existing_listing_ids: set[str],
) -> list[str]:
    """Возвращает список причин отклонения (пусто = прошёл). Без price_band."""
    reasons: list[str] = []
    lid = (c.listing_id or "").strip()
    if lid and lid in existing_listing_ids:
        reasons.append("already_in_catalog")

    require_fields = bool(criteria.get("require_year_price", True))
    if require_fields:
        if c.year is None:
            reasons.append("missing_year")
        if c.price_cny is None or float(c.price_cny) <= 0:
            reasons.append("missing_price")

    year_min = criteria.get("year_min")
    if year_min is not None and c.year is not None and c.year < int(year_min):
        reasons.append(f"year<{year_min}")

    year_max = criteria.get("year_max")
    if year_max is not None and c.year is not None and c.year > int(year_max):
        reasons.append(f"year>{year_max}")

    mileage_max = criteria.get("mileage_max")
    if mileage_max is not None:
        if c.mileage_km is None:
            reasons.append("missing_mileage")
        elif c.mileage_km > int(mileage_max):
            reasons.append(f"mileage>{mileage_max}")

    age_min = criteria.get("reg_age_years_min")
    age_max = criteria.get("reg_age_years_max")
    age = _registration_age_years(c.registration_date)
    if age is None and c.year:
        # С витрины часто есть год, но нет точной даты 上牌 — для фильтра возраста хватает года.
        age = max(0.0, float(_msk_today().year - int(c.year)) + 0.5)
    if age_min is not None or age_max is not None:
        if age is None:
            reasons.append("missing_registration_date")
        else:
            if age_min is not None and age < float(age_min):
                reasons.append(f"reg_age<{age_min}")
            if age_max is not None and age > float(age_max):
                reasons.append(f"reg_age>{age_max}")

    brands = criteria.get("brands")
    if brands and isinstance(brands, list) and brands:
        allowed = {str(b).strip().lower() for b in brands if str(b).strip()}
        name = (c.brand_name or "").strip().lower()
        if allowed and name and name not in allowed:
            reasons.append("brand_not_allowed")

    marketplaces = criteria.get("marketplaces")
    if marketplaces and isinstance(marketplaces, list) and marketplaces:
        allowed_mp = {str(m).strip().lower() for m in marketplaces if str(m).strip()}
        mp = (c.marketplace or "").strip().lower()
        if allowed_mp and mp and mp not in allowed_mp:
            reasons.append("marketplace_not_allowed")

    return reasons


def _price_band_reject_ids(
    candidates: list[ImportCandidate],
    criteria: dict[str, Any],
) -> set[int]:
    """
    mid_upper: внутри группы (brand|model) отсечь нижний терциль цены.
    Нужно ≥3 машин с ценой в группе; иначе band не применяем.
    """
    band = str(criteria.get("price_band") or "").strip().lower()
    if band not in ("mid_upper", "mid-upper", "upper_mid"):
        return set()

    groups: dict[str, list[ImportCandidate]] = {}
    for c in candidates:
        key = f"{(c.brand_name or '').strip().lower()}|{(c.model_name or '').strip().lower()}"
        if not key.strip("|"):
            key = f"title:{(c.title or '')[:40].lower()}"
        groups.setdefault(key, []).append(c)

    reject: set[int] = set()
    for rows in groups.values():
        priced = [
            c
            for c in rows
            if c.price_cny is not None and float(c.price_cny) > 0
        ]
        if len(priced) < 3:
            continue
        prices = sorted(float(c.price_cny) for c in priced)
        # нижняя граница среднего терциля ≈ 33-й перцентиль
        cut_idx = max(0, len(prices) // 3 - 1)
        threshold = prices[cut_idx]
        for c in priced:
            if float(c.price_cny) <= threshold:
                reject.add(c.id)
    return reject


def _catalog_listing_ids(db: Session) -> set[str]:
    rows = db.execute(
        select(Car.source_listing_id).where(
            Car.source_listing_id.isnot(None),
            Car.is_active.is_(True),
        )
    ).scalars().all()
    return {str(x) for x in rows if x}


def _apply_listing_card_fields(c: ImportCandidate, card: ListingCard | None) -> None:
    if card is None:
        return
    if card.title and not (c.title or "").strip():
        c.title = card.title[:512]
    if c.year is None and card.year:
        c.year = int(card.year)
    if c.price_cny is None and card.price_cny:
        c.price_cny = float(card.price_cny)
    if c.mileage_km is None and card.mileage_km:
        c.mileage_km = int(card.mileage_km)
    if not (c.registration_date or "").strip() and card.registration_date:
        c.registration_date = str(card.registration_date)[:32]
    if not getattr(c, "horsepower", None) and card.horsepower:
        c.horsepower = int(card.horsepower)


def _upsert_candidate(
    db: Session,
    *,
    profile_id: int,
    url: str,
    listing_id: str,
    marketplace: str,
    brand_id: int | None,
    brand_name: str,
    model_id: int | None,
    model_name: str,
    card: ListingCard | None = None,
) -> tuple[ImportCandidate | None, bool]:
    """Returns (candidate, created)."""
    existing = db.execute(
        select(ImportCandidate).where(
            ImportCandidate.profile_id == profile_id,
            ImportCandidate.listing_id == listing_id,
        )
    ).scalar_one_or_none()
    if existing:
        _apply_listing_card_fields(existing, card)
        return existing, False

    c = ImportCandidate(
        profile_id=profile_id,
        url=url[:2048],
        listing_id=listing_id[:128],
        marketplace=(marketplace or "che168")[:32],
        brand_id=brand_id,
        brand_name=(brand_name or "")[:128],
        model_id=model_id,
        model_name=(model_name or "")[:128],
        status="new",
        reasons=[],
        filter_reasons=[],
    )
    _apply_listing_card_fields(c, card)
    db.add(c)
    return c, True


def _series_targets(
    db: Session,
    payload: DiscoverIn,
    profile: SearchProfile,
) -> list[tuple[str, int | None, str, int | None, str]]:
    """Список (series_url, brand_id, brand_name, model_id, model_name)."""
    targets: list[tuple[str, int | None, str, int | None, str]] = []
    seen_urls: set[str] = set()

    def add(
        url: str,
        brand_id: int | None,
        brand_name: str,
        model_id: int | None,
        model_name: str,
    ) -> None:
        u = normalize_series_url(url)
        if not u or u in seen_urls:
            return
        seen_urls.add(u)
        targets.append((u, brand_id, brand_name, model_id, model_name))

    def add_series(raw: Any) -> None:
        u, brand_id, model_id = parse_series_url_item(raw)
        if not u:
            return
        brand_name = ""
        model_name = ""
        if model_id:
            brand, model = lookup_model_with_brand(db, model_id)
            if model:
                model_name = model.name or ""
                if brand:
                    brand_id = brand.id
                    brand_name = brand.name or ""
        elif brand_id:
            brand = db.get(CarBrand, brand_id)
            if brand:
                brand_name = brand.name or ""
        if not brand_id and not model_id:
            ref = resolve_catalog(db, series_url=u)
            add(u, ref.brand_id, ref.brand_name, ref.model_id, ref.model_name)
            return
        add(u, brand_id, brand_name, model_id, model_name)

    # Если агент явно передал series_urls — только они (не дублируем весь профиль).
    criteria = profile.criteria or {}
    explicit_urls = [str(u) for u in (payload.series_urls or []) if str(u).strip()]
    if explicit_urls:
        for raw in explicit_urls:
            add_series(raw)
    else:
        crit_urls = criteria.get("series_urls")
        if isinstance(crit_urls, list):
            for raw in crit_urls:
                add_series(raw)

    model_ids = list(payload.model_ids or [])
    crit_ids = criteria.get("model_ids")
    if isinstance(crit_ids, list):
        for mid in crit_ids:
            try:
                model_ids.append(int(mid))
            except (TypeError, ValueError):
                pass

    if model_ids:
        models = (
            db.execute(
                select(CarModel)
                .options(joinedload(CarModel.brand))
                .where(CarModel.id.in_(set(model_ids)))
            )
            .scalars()
            .unique()
            .all()
        )
        for m in models:
            if m.che168_url:
                brand = m.brand
                add(
                    m.che168_url,
                    brand.id if brand else None,
                    brand.name if brand else "",
                    m.id,
                    m.name or "",
                )

    # Fallback только если в профиле ещё нет series_urls (bootstrap)
    crit_urls = criteria.get("series_urls")
    if not targets and not explicit_urls and not (isinstance(crit_urls, list) and crit_urls):
        for raw in DEFAULT_SOURCING_SERIES_URLS:
            add_series(raw)

    if payload.use_whitelist and not targets:
        wls = (
            db.execute(
                select(ModelWhitelist)
                .options(
                    joinedload(ModelWhitelist.model).joinedload(CarModel.brand),
                )
                .where(ModelWhitelist.enabled.is_(True))
            )
            .scalars()
            .unique()
            .all()
        )
        for wl in wls:
            m = wl.model
            if not m or not m.che168_url:
                continue
            brand = m.brand
            add(
                m.che168_url,
                brand.id if brand else None,
                brand.name if brand else "",
                m.id,
                m.name or "",
            )

    return targets


def _import_plan_agent_out(db: Session) -> ImportPlanAgentOut:
    plan = ensure_import_plan(db)
    rows = [
        ImportPlanAgentItemOut(
            id=i.id,
            client_key=i.client_key or "",
            marketplace=i.marketplace or "che168",
            brand_name=i.brand_name or "",
            model_name=i.model_name or "",
            url=i.url or "",
            status=i.status or "",
            attempts=int(i.attempts or 0),
            message=i.message or "",
        )
        for i in sorted(plan.items, key=lambda x: (x.sort_order, x.id))
    ]
    return ImportPlanAgentOut(
        status=plan.status,
        running=plan.status in ("running", "stopping"),
        banner=plan.banner or "",
        error=plan.error or "",
        updated_at=plan.updated_at,
        rows=rows,
    )


# ---- routes ----


@router.get("/profiles", response_model=list[SearchProfileOut])
def list_profiles(
    enabled_only: bool = Query(default=False),
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    q = select(SearchProfile).order_by(SearchProfile.id)
    if enabled_only:
        q = q.where(SearchProfile.enabled.is_(True))
    return list(db.execute(q).scalars().all())


@router.get("/profiles/{profile_id}", response_model=SearchProfileOut)
def get_profile(
    profile_id: int,
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    return _get_profile(db, profile_id)


@router.patch("/profiles/{profile_id}", response_model=SearchProfileOut)
def patch_profile(
    profile_id: int,
    payload: SearchProfileUpdateIn,
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    profile = _get_profile(db, profile_id)
    if payload.name is not None:
        profile.name = payload.name[:128]
    if payload.enabled is not None:
        profile.enabled = payload.enabled
    if payload.criteria is not None:
        profile.criteria = payload.criteria
    if payload.brief is not None:
        profile.brief = payload.brief
    if payload.max_select is not None:
        profile.max_select = payload.max_select
    profile.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(profile)
    return profile


@router.get("/profiles/{profile_id}/market-research", response_model=MarketResearchOut)
def get_market_research(
    profile_id: int,
    max_age_days: int = Query(default=7, ge=1, le=90),
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    profile = _get_profile(db, profile_id)
    return market_research_for_profile(profile, max_age_days=max_age_days)


@router.put("/profiles/{profile_id}/market-research", response_model=MarketResearchOut)
def put_market_research(
    profile_id: int,
    payload: MarketResearchIn,
    max_age_days: int = Query(default=7, ge=1, le=90),
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    profile = _get_profile(db, profile_id)
    criteria = dict(profile.criteria or {})
    at = _parse_iso_date(payload.market_research_at) or _msk_today()
    hot = [str(x).strip() for x in (payload.market_hot_models or []) if str(x).strip()][:40]
    criteria["market_research_at"] = at.isoformat()
    criteria["market_hot_models"] = hot
    profile.criteria = criteria
    profile.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(profile)
    return market_research_for_profile(profile, max_age_days=max_age_days)


@router.get("/quota", response_model=QuotaOut)
def get_quota(
    profile_id: int = Query(...),
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    profile = _get_profile(db, profile_id)
    return quota_for_profile(db, profile)


@router.post("/discover", response_model=DiscoverOut)
def discover(
    payload: DiscoverIn,
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    if payload.profile_id is None:
        raise HTTPException(status_code=400, detail="profile_id is required")
    profile = _get_profile(db, payload.profile_id)
    targets = _series_targets(db, payload, profile)
    if not targets:
        raise HTTPException(
            status_code=400,
            detail=(
                "Нет series URL: заполните criteria.series_urls в профиле "
                "(админка /staff/search-profiles) или передайте series_urls в запросе"
            ),
        )

    created = 0
    skipped = 0
    touched_ids: list[int] = []
    series_ok = 0
    series_errors: list[str] = []

    # Без CN-прокси Playwright на VPS часто висит 60–120с на антиботе.
    # С CHE168_PROXY витрина открывается браузером; HTTP почти всегда stub.
    # Карточки объявлений не открываем: год/пробег/цена — с плитки списка.
    use_playwright = bool(che168_proxy_url())
    budget_sec = float(os.getenv("AGENT_DISCOVER_BUDGET_SEC", "200"))
    deadline = time.monotonic() + budget_sec
    http_timeout = float(os.getenv("AGENT_DISCOVER_HTTP_TIMEOUT_SEC", "12"))
    max_created = payload.max_created

    by_url = {t[0]: t for t in targets}
    remaining = deadline - time.monotonic()
    nav_timeout_ms = int(min(25_000, max(5_000, remaining * 1000))) if use_playwright else None
    scraped = parse_che168_listing_cards_many(
        [t[0] for t in targets],
        payload.limit_per_series,
        allow_playwright=use_playwright,
        http_timeout=http_timeout,
        nav_timeout_ms=nav_timeout_ms,
        deadline=deadline,
    )

    for series_url, cards, err in scraped:
        meta = by_url.get(series_url)
        brand_id = meta[1] if meta else None
        brand_name = meta[2] if meta else ""
        model_id = meta[3] if meta else None
        model_name = meta[4] if meta else ""
        if err and not cards:
            series_errors.append(
                err if err.startswith("budget_exceeded") else f"{series_url}: {err}"
            )
            continue
        series_ok += 1
        logger.info(
            "discover ok %s cards=%s year_price=%s",
            series_url,
            len(cards),
            sum(1 for c in cards if c.year and c.price_cny),
        )
        if max_created is not None and created >= max_created:
            break
        for card in cards:
            if max_created is not None and created >= max_created:
                break
            link = card.url
            norm = normalize_import_detail_url(link) or link
            try:
                listing_id = source_listing_id_from_url(norm)
            except ValueError:
                skipped += 1
                continue
            mp = marketplace_from_detail_url(norm) or "che168"
            cand, was_created = _upsert_candidate(
                db,
                profile_id=profile.id,
                url=norm,
                listing_id=listing_id,
                marketplace=mp,
                brand_id=brand_id,
                brand_name=brand_name,
                model_id=model_id,
                model_name=model_name,
                card=card,
            )
            if cand:
                if was_created:
                    created += 1
                    db.flush()
                else:
                    skipped += 1
                if cand.id and cand.id not in touched_ids:
                    touched_ids.append(cand.id)
        db.commit()

    if series_ok == 0 and series_errors:
        raise HTTPException(
            status_code=502,
            detail=(
                "discover: ни одна series URL не открылась. "
                + "; ".join(series_errors[:3])
            ),
        )

    db.commit()
    candidates = []
    if touched_ids:
        candidates = list(
            db.execute(
                select(ImportCandidate).where(ImportCandidate.id.in_(touched_ids))
            )
            .scalars()
            .all()
        )
    return DiscoverOut(
        created=created,
        skipped_existing=skipped,
        candidates=[_candidate_out(c) for c in candidates],
        series_ok=series_ok,
        series_failed=len(series_errors),
        series_errors=series_errors[:20],
    )


@router.post("/enrich", response_model=EnrichOut)
def enrich_candidates(
    payload: EnrichIn,
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    """Парсит карточки che168 → year / price / mileage / registration_date / title."""
    profile = _get_profile(db, payload.profile_id)
    q = select(ImportCandidate).where(ImportCandidate.profile_id == profile.id)
    if payload.candidate_ids:
        q = q.where(ImportCandidate.id.in_(payload.candidate_ids))
    else:
        q = q.where(ImportCandidate.status.in_(("new", "scored")))
    q = q.order_by(ImportCandidate.id.desc()).limit(payload.limit * 3)
    rows = list(db.execute(q).scalars().all())

    to_enrich: list[ImportCandidate] = []
    for c in rows:
        if len(to_enrich) >= payload.limit:
            break
        if payload.only_missing:
            missing = (
                c.year is None
                or c.price_cny is None
                or c.mileage_km is None
                or not (c.registration_date or "").strip()
            )
            if not missing:
                continue
        to_enrich.append(c)

    enriched = 0
    failed = 0
    use_playwright = bool(che168_proxy_url())
    budget_sec = float(
        payload.budget_sec
        if payload.budget_sec is not None
        else os.getenv("AGENT_ENRICH_BUDGET_SEC", "60" if use_playwright else "90")
    )
    deadline = time.monotonic() + budget_sec
    http_timeout = float(os.getenv("AGENT_ENRICH_HTTP_TIMEOUT_SEC", "12"))
    for c in to_enrich:
        if time.monotonic() >= deadline:
            logger.warning(
                "enrich budget %ss exceeded after %s ok / %s fail",
                int(budget_sec),
                enriched,
                failed,
            )
            break
        try:
            parsed = parse_che168_detail(
                c.url,
                allow_playwright=use_playwright,
                http_timeout=http_timeout,
            )
        except Exception as e:
            logger.warning("enrich failed for %s: %s", c.url, e)
            failed += 1
            continue
        if parsed.year is not None:
            c.year = parsed.year
        if parsed.price_cny is not None:
            c.price_cny = float(parsed.price_cny)
        if parsed.mileage_km is not None:
            c.mileage_km = int(parsed.mileage_km)
        if parsed.registration_date:
            c.registration_date = str(parsed.registration_date)[:32]
        if parsed.title:
            c.title = str(parsed.title)[:512]
        if parsed.series_raw and not c.model_name:
            c.model_name = str(parsed.series_raw)[:128]
        ensure_candidate_catalog(
            db,
            c,
            series_raw=parsed.series_raw,
        )
        c.updated_at = datetime.utcnow()
        enriched += 1
        db.commit()

    db.commit()
    return EnrichOut(
        enriched=enriched,
        failed=failed,
        candidates=[_candidate_out(c) for c in to_enrich],
    )


@router.post("/filter", response_model=FilterOut)
def filter_candidates(
    payload: FilterIn,
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    profile = _get_profile(db, payload.profile_id)
    criteria = _merge_criteria(profile.criteria, payload.overlay_criteria)
    q = select(ImportCandidate).where(ImportCandidate.profile_id == profile.id)
    if payload.candidate_ids:
        q = q.where(ImportCandidate.id.in_(payload.candidate_ids))
    else:
        q = q.where(ImportCandidate.status.in_(("new", "filtered", "scored")))
    rows = list(db.execute(q).scalars().all())
    existing = _catalog_listing_ids(db)

    prelim_pass: list[ImportCandidate] = []
    rejected: list[ImportCandidate] = []
    for c in rows:
        reasons = hard_filter_candidate(c, criteria, existing_listing_ids=existing)
        if reasons:
            c.status = "filtered"
            c.filter_reasons = reasons
            rejected.append(c)
        else:
            prelim_pass.append(c)
        c.updated_at = datetime.utcnow()

    band_reject = _price_band_reject_ids(prelim_pass, criteria)
    passed: list[ImportCandidate] = []
    for c in prelim_pass:
        if c.id in band_reject:
            c.status = "filtered"
            reasons = list(c.filter_reasons or [])
            if "price_band_bottom" not in reasons:
                reasons.append("price_band_bottom")
            c.filter_reasons = reasons
            rejected.append(c)
        else:
            if c.status == "filtered":
                c.status = "new"
            c.filter_reasons = []
            passed.append(c)
        c.updated_at = datetime.utcnow()

    db.commit()
    return FilterOut(
        passed=[_candidate_out(c) for c in passed],
        rejected=[_candidate_out(c) for c in rejected],
    )


@router.post("/collect", response_model=CollectOut)
def collect_listings(
    payload: CollectIn,
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    """
    Детерминированный прогон без LLM: discover (с ретраями) → enrich → filter.
    Возвращает компактный пул для shortlist + статус для TG.
    """
    profile = _get_profile(db, payload.profile_id)
    quota = quota_for_profile(db, profile)
    market = market_research_for_profile(
        profile, max_age_days=payload.market_research_max_age_days
    )
    if quota.needed <= 0:
        return CollectOut(
            status="quota_closed",
            message="Дневная квота закрыта (needed=0).",
            profile_id=profile.id,
            needed=0,
            already_today=quota.already_today,
            market_research=market,
        )

    per_series = max(20, min(payload.limit_per_series, 40))
    # n8n toolCode (N8N_RUNNERS_TASK_TIMEOUT) рвёт запрос на 300с — /collect должен уложиться раньше.
    collect_budget = float(os.getenv("AGENT_COLLECT_BUDGET_SEC", "240"))
    collect_started = time.monotonic()
    collect_deadline = collect_started + collect_budget
    logger.info(
        "collect start profile=%s budget=%ss parse_limit=%s needed=%s",
        profile.id,
        int(collect_budget),
        payload.parse_limit,
        quota.needed,
    )
    retries = max(1, payload.discover_retries)
    if che168_proxy_url():
        retries = min(retries, 1)
    last_discover: DiscoverOut | None = None
    attempts = 0
    for attempt in range(retries):
        attempts = attempt + 1
        try:
            last_discover = discover(
                DiscoverIn(
                    profile_id=profile.id,
                    use_whitelist=False,
                    limit_per_series=per_series,
                    max_created=payload.parse_limit,
                ),
                db=db,
                _=None,
            )
        except HTTPException as e:
            detail = e.detail if isinstance(e.detail, str) else str(e.detail)
            last_discover = DiscoverOut(
                created=0,
                skipped_existing=0,
                candidates=[],
                series_ok=0,
                series_failed=1,
                series_errors=[detail],
            )
        except Exception as e:
            last_discover = DiscoverOut(
                created=0,
                skipped_existing=0,
                candidates=[],
                series_ok=0,
                series_failed=1,
                series_errors=[str(e)],
            )
        if last_discover and (last_discover.created > 0 or last_discover.series_ok > 0):
            break
        if attempt < retries - 1 and payload.discover_retry_pause_sec > 0:
            time.sleep(float(payload.discover_retry_pause_sec))

    assert last_discover is not None
    if last_discover.series_ok == 0 and last_discover.created == 0:
        return CollectOut(
            status="empty",
            message=(
                f"Discover пуст после {attempts} попыток. "
                "Источник che168 недоступен или series_urls без объявлений."
            ),
            profile_id=profile.id,
            needed=quota.needed,
            already_today=quota.already_today,
            discover_attempts=attempts,
            created=0,
            series_ok=last_discover.series_ok,
            series_failed=last_discover.series_failed,
            series_errors=last_discover.series_errors[:20],
            market_research=market,
        )

    # Поля года/цены/пробега уже с витрины. Карточки Playwright не открываем.
    remaining = collect_deadline - time.monotonic()
    hp_budget = max(0.0, min(20.0, remaining - 15.0))
    hp_deadline = time.monotonic() + hp_budget
    hp_filled = 0
    for c_out in last_discover.candidates:
        if time.monotonic() >= hp_deadline:
            break
        row = db.get(ImportCandidate, c_out.id)
        if not row or getattr(row, "horsepower", None):
            continue
        hp = horsepower_from_carinfo_url(row.url, timeout=4.0)
        if hp:
            row.horsepower = hp
            hp_filled += 1
    if hp_filled:
        db.commit()
    if last_discover.candidates:
        ids = [c.id for c in last_discover.candidates if c.id]
        refreshed = list(
            db.execute(select(ImportCandidate).where(ImportCandidate.id.in_(ids)))
            .scalars()
            .all()
        )
        last_discover.candidates = [_candidate_out(c) for c in refreshed]
    with_year_price = sum(
        1
        for c in last_discover.candidates
        if c.year is not None and c.price_cny is not None
    )
    enrich_out = EnrichOut(
        enriched=with_year_price,
        failed=max(0, len(last_discover.candidates) - with_year_price),
        candidates=last_discover.candidates,
    )
    logger.info(
        "collect after discover created=%s series_ok=%s series_failed=%s remaining=%.0fs list_fields=%s hp=%s",
        last_discover.created,
        last_discover.series_ok,
        last_discover.series_failed,
        remaining,
        with_year_price,
        hp_filled,
    )
    # Не фильтровать все 700+ старых filtered — только карточки этого прогона.
    filter_ids: list[int] = []
    for c in last_discover.candidates:
        if c.id:
            filter_ids.append(c.id)
    for c in enrich_out.candidates:
        if c.id and c.id not in filter_ids:
            filter_ids.append(c.id)
    if filter_ids:
        filter_out = filter_candidates(
            FilterIn(profile_id=profile.id, candidate_ids=filter_ids),
            db=db,
            _=None,
        )
    else:
        filter_out = FilterOut(passed=[], rejected=[])
    # Берём свежие passed с полями, ограничиваем для LLM
    passed_sorted = sorted(
        filter_out.passed,
        key=lambda c: (
            0 if c.price_cny is not None else 1,
            0 if c.year is not None else 1,
            -(c.id or 0),
        ),
    )
    pool = passed_sorted[: payload.filter_limit]
    listings = [_compact_listing(c) for c in pool[: payload.llm_shortlist_limit]]

    status: Literal["ok", "empty", "quota_closed", "error"] = (
        "ok" if listings else "empty"
    )
    message = (
        f"С витрины (карточки не открывали): created={last_discover.created}, "
        f"with_year_price={enrich_out.enriched}, passed={len(filter_out.passed)}, "
        f"shortlist_pool={len(listings)}."
        if listings
        else (
            f"После filter пусто (created={last_discover.created}, "
            f"with_year_price={enrich_out.enriched}, rejected={len(filter_out.rejected)})."
        )
    )
    elapsed = time.monotonic() - collect_started
    logger.info(
        "collect done status=%s created=%s enriched=%s passed=%s listings=%s elapsed=%.1fs errors=%s",
        status,
        last_discover.created,
        enrich_out.enriched,
        len(filter_out.passed),
        len(listings),
        elapsed,
        last_discover.series_errors[:5],
    )
    return CollectOut(
        status=status,
        message=message,
        profile_id=profile.id,
        needed=quota.needed,
        already_today=quota.already_today,
        discover_attempts=attempts,
        created=last_discover.created,
        enriched=enrich_out.enriched,
        enrich_failed=enrich_out.failed,
        passed=len(filter_out.passed),
        rejected=len(filter_out.rejected),
        series_ok=last_discover.series_ok,
        series_failed=last_discover.series_failed,
        series_errors=last_discover.series_errors[:20],
        listings=listings,
        market_research=market,
    )


@router.get("/candidates", response_model=list[ImportCandidateOut])
def list_candidates(
    profile_id: int = Query(...),
    status: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    q = (
        select(ImportCandidate)
        .where(ImportCandidate.profile_id == profile_id)
        .order_by(ImportCandidate.score.desc().nullslast(), ImportCandidate.id.desc())
        .limit(limit)
    )
    if status:
        q = q.where(ImportCandidate.status == status)
    return [_candidate_out(c) for c in db.execute(q).scalars().all()]


@router.post("/candidates/score", response_model=list[ImportCandidateOut])
def score_candidates(
    payload: ScoreIn,
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    if not payload.items:
        return []
    ids = [i.id for i in payload.items]
    by_id = {
        c.id: c
        for c in db.execute(
            select(ImportCandidate).where(ImportCandidate.id.in_(ids))
        )
        .scalars()
        .all()
    }
    out: list[ImportCandidate] = []
    for item in payload.items:
        c = by_id.get(item.id)
        if not c:
            continue
        c.score = float(item.score)
        c.reasons = list(item.reasons or [])
        if item.year is not None:
            c.year = item.year
        if item.price_cny is not None:
            c.price_cny = item.price_cny
        if item.mileage_km is not None:
            c.mileage_km = item.mileage_km
        if item.registration_date is not None:
            c.registration_date = item.registration_date[:32]
        if item.title is not None:
            c.title = item.title[:512]
        if item.brand_name is not None:
            c.brand_name = item.brand_name[:128]
        if item.model_name is not None:
            c.model_name = item.model_name[:128]
        ensure_candidate_catalog(db, c)
        if c.status in ("new", "filtered", "scored"):
            c.status = "scored"
        c.updated_at = datetime.utcnow()
        out.append(c)
    db.commit()
    return [_candidate_out(c) for c in out]


@router.post("/apply-to-import-plan", response_model=ApplyOut)
def apply_to_import_plan(
    payload: ApplyIn,
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    profile = _get_profile(db, payload.profile_id)
    quota = quota_for_profile(db, profile)
    limit = payload.limit if payload.limit is not None else quota.needed
    limit = min(limit, quota.needed)
    if limit <= 0:
        plan = ensure_import_plan(db)
        return ApplyOut(
            applied=0,
            needed=0,
            already_today=quota.already_today,
            plan_rows=len(plan.items),
            candidates=[],
            skipped_missing_model=0,
        )

    plan = ensure_import_plan(db)
    if plan.status in ("running", "stopping"):
        raise HTTPException(
            status_code=409,
            detail="Нельзя менять план во время обхода. Сначала остановите.",
        )

    q = select(ImportCandidate).where(ImportCandidate.profile_id == profile.id)
    if payload.candidate_ids:
        q = q.where(ImportCandidate.id.in_(payload.candidate_ids))
    else:
        q = q.where(ImportCandidate.status.in_(("scored", "new")))
    if payload.min_score is not None:
        q = q.where(ImportCandidate.score >= payload.min_score)
    q = q.order_by(
        ImportCandidate.score.desc().nullslast(),
        ImportCandidate.id.asc(),
    ).limit(max(limit * 4, limit + 20))

    pool = list(db.execute(q).scalars().all())
    if not pool:
        return ApplyOut(
            applied=0,
            needed=quota.needed,
            already_today=quota.already_today,
            plan_rows=len(plan.items),
            candidates=[],
            skipped_missing_model=0,
        )

    now = datetime.utcnow()
    if payload.replace_plan:
        db.execute(delete(ImportPlanItem).where(ImportPlanItem.plan_id == plan.id))
        sort_base = 0
        existing_urls: set[str] = set()
    else:
        existing_urls = {
            (i.url or "").strip()
            for i in plan.items
            if (i.url or "").strip()
        }
        sort_base = max((i.sort_order for i in plan.items), default=-1) + 1

    selected: list[ImportCandidate] = []
    skipped_missing_model = 0
    for c in pool:
        if len(selected) >= limit:
            break
        url = (c.url or "").strip()
        if url and url in existing_urls:
            continue
        if not ensure_candidate_catalog(db, c):
            # Последняя попытка: допарсить карточку, если title пустой
            if not (c.title or "").strip() and url:
                try:
                    parsed = parse_che168_detail(
                        url, allow_playwright=False, http_timeout=15.0
                    )
                    if parsed.title:
                        c.title = str(parsed.title)[:512]
                    if parsed.series_raw and not c.model_name:
                        c.model_name = str(parsed.series_raw)[:128]
                    ensure_candidate_catalog(db, c, series_raw=parsed.series_raw)
                except Exception as e:
                    logger.warning("apply catalog resolve failed for %s: %s", url, e)
        if not c.model_id:
            skipped_missing_model += 1
            logger.info(
                "skip candidate %s for import-plan: no model_id (title=%r)",
                c.id,
                (c.title or "")[:80],
            )
            continue
        selected.append(c)

    if not selected:
        db.commit()
        return ApplyOut(
            applied=0,
            needed=quota.needed,
            already_today=quota.already_today,
            plan_rows=len(plan.items),
            candidates=[],
            skipped_missing_model=skipped_missing_model,
        )

    for idx, c in enumerate(selected):
        db.add(
            ImportPlanItem(
                plan_id=plan.id,
                client_key=str(uuid.uuid4())[:64],
                sort_order=sort_base + idx,
                marketplace=(c.marketplace or "che168")[:32],
                brand_id=c.brand_id,
                brand_name=(c.brand_name or "")[:128],
                model_id=c.model_id,
                model_name=(c.model_name or "")[:128],
                generation_id=c.generation_id,
                generation_name=(c.generation_name or "")[:128],
                url=(c.url or "").strip()[:2048],
                status="pending",
                attempts=0,
                message=(f"score={c.score}" if c.score is not None else "")[:512],
            )
        )
        c.status = "selected"
        c.selected_at = now
        c.updated_at = now

    plan.error = ""
    plan.updated_at = now
    db.commit()

    quota2 = quota_for_profile(db, profile)
    plan = ensure_import_plan(db)
    return ApplyOut(
        applied=len(selected),
        needed=quota2.needed,
        already_today=quota2.already_today,
        plan_rows=len(plan.items),
        candidates=[_candidate_out(c) for c in selected],
        skipped_missing_model=skipped_missing_model,
    )


@router.get("/import-plan", response_model=ImportPlanAgentOut)
def agent_get_import_plan(
    pending_only: bool = Query(
        default=False,
        description="Если true — только строки не success (что ещё к обходу / апруву)",
    ),
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    out = _import_plan_agent_out(db)
    if pending_only:
        out.rows = [r for r in out.rows if r.status not in ("success",)]
    return out


@router.post("/import-plan/start", response_model=ImportPlanAgentOut)
def agent_start_import_plan(
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    plan = ensure_import_plan(db)
    if plan.status in ("running", "stopping"):
        return _import_plan_agent_out(db)
    start_import_plan(db)
    return _import_plan_agent_out(db)


@router.post("/import-plan/stop", response_model=ImportPlanAgentOut)
def agent_stop_import_plan(
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    request_stop_import_plan(db)
    return _import_plan_agent_out(db)


@router.get("/memory", response_model=list[MemoryOut])
def list_memory(
    agent_key: str = Query(default="sourcing"),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    rows = (
        db.execute(
            select(AgentMemory)
            .where(AgentMemory.agent_key == agent_key)
            .order_by(AgentMemory.created_at.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    return list(rows)


@router.post("/memory", response_model=MemoryOut)
def create_memory(
    payload: MemoryCreateIn,
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    row = AgentMemory(
        agent_key=(payload.agent_key or "sourcing")[:64],
        kind=payload.kind,
        content=payload.content.strip(),
        source=payload.source,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.post("/approval-sessions", response_model=ApprovalSessionOut)
def create_approval_session(
    payload: ApprovalSessionCreateIn,
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    _get_profile(db, payload.profile_id)
    row = SourcingApprovalSession(
        profile_id=payload.profile_id,
        status="pending",
        candidate_ids=list(payload.candidate_ids or []),
        telegram_chat_id=(payload.telegram_chat_id or "")[:64],
        telegram_message_id=(payload.telegram_message_id or "")[:64],
        summary=payload.summary or "",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/approval-sessions/{session_id}", response_model=ApprovalSessionOut)
def get_approval_session(
    session_id: int,
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    row = db.get(SourcingApprovalSession, session_id)
    if not row:
        raise HTTPException(status_code=404, detail="approval session not found")
    return row


@router.patch("/approval-sessions/{session_id}", response_model=ApprovalSessionOut)
def patch_approval_session(
    session_id: int,
    payload: ApprovalSessionPatchIn,
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    row = db.get(SourcingApprovalSession, session_id)
    if not row:
        raise HTTPException(status_code=404, detail="approval session not found")
    if payload.status is not None:
        row.status = payload.status
    if payload.telegram_chat_id is not None:
        row.telegram_chat_id = payload.telegram_chat_id[:64]
    if payload.telegram_message_id is not None:
        row.telegram_message_id = payload.telegram_message_id[:64]
    if payload.summary is not None:
        row.summary = payload.summary
    if payload.candidate_ids is not None:
        row.candidate_ids = list(payload.candidate_ids)
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row
