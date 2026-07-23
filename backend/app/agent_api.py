"""Agent API: capabilities сайта для внешнего sourcing-агента (n8n).

Auth: header X-Agent-Secret == AGENT_API_SECRET.
LLM / Telegram / search — снаружи; здесь только данные и che168 discover.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, joinedload

from .che168_parser import (
    marketplace_from_detail_url,
    normalize_import_detail_url,
    parse_che168_listing_links,
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
    CarModel,
    ImportCandidate,
    ImportPlanItem,
    ModelWhitelist,
    SearchProfile,
    SourcingApprovalSession,
)

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
    use_whitelist: bool = True


class DiscoverOut(BaseModel):
    created: int
    skipped_existing: int
    candidates: list[ImportCandidateOut]


class FilterIn(BaseModel):
    profile_id: int
    candidate_ids: list[int] | None = None
    overlay_criteria: dict[str, Any] | None = None


class FilterOut(BaseModel):
    passed: list[ImportCandidateOut]
    rejected: list[ImportCandidateOut]


class ScoreItemIn(BaseModel):
    id: int
    score: float = Field(..., ge=0, le=100)
    reasons: list[str] = Field(default_factory=list)
    year: int | None = None
    price_cny: float | None = None
    mileage_km: int | None = None
    title: str | None = None


class ScoreIn(BaseModel):
    items: list[ScoreItemIn]


class ApplyIn(BaseModel):
    profile_id: int
    min_score: float | None = None
    limit: int | None = Field(default=None, ge=1, le=100)
    candidate_ids: list[int] | None = None
    replace_plan: bool = False
    """Если True — заменить весь import-plan; иначе дополнить pending-строками."""


class ApplyOut(BaseModel):
    applied: int
    needed: int
    already_today: int
    plan_rows: int
    candidates: list[ImportCandidateOut]


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
    start_local = datetime.combine(d, time.min, tzinfo=MSK)
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


def _merge_criteria(
    base: dict[str, Any] | None, overlay: dict[str, Any] | None
) -> dict[str, Any]:
    out = dict(base or {})
    if overlay:
        out.update(overlay)
    return out


def hard_filter_candidate(
    c: ImportCandidate,
    criteria: dict[str, Any],
    *,
    existing_listing_ids: set[str],
) -> list[str]:
    """Возвращает список причин отклонения (пусто = прошёл)."""
    reasons: list[str] = []
    lid = (c.listing_id or "").strip()
    if lid and lid in existing_listing_ids:
        reasons.append("already_in_catalog")

    year_min = criteria.get("year_min")
    if year_min is not None and c.year is not None and c.year < int(year_min):
        reasons.append(f"year<{year_min}")

    year_max = criteria.get("year_max")
    if year_max is not None and c.year is not None and c.year > int(year_max):
        reasons.append(f"year>{year_max}")

    mileage_max = criteria.get("mileage_max")
    if (
        mileage_max is not None
        and c.mileage_km is not None
        and c.mileage_km > int(mileage_max)
    ):
        reasons.append(f"mileage>{mileage_max}")

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

    # max_total_rub — без расчёта таможни на listing-level skip; агент может overlay
    return reasons


def _catalog_listing_ids(db: Session) -> set[str]:
    rows = db.execute(
        select(Car.source_listing_id).where(
            Car.source_listing_id.isnot(None),
            Car.is_active.is_(True),
        )
    ).scalars().all()
    return {str(x) for x in rows if x}


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
) -> tuple[ImportCandidate | None, bool]:
    """Returns (candidate, created)."""
    existing = db.execute(
        select(ImportCandidate).where(
            ImportCandidate.profile_id == profile_id,
            ImportCandidate.listing_id == listing_id,
        )
    ).scalar_one_or_none()
    if existing:
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
        u = (url or "").strip()
        if not u or u in seen_urls:
            return
        seen_urls.add(u)
        targets.append((u, brand_id, brand_name, model_id, model_name))

    for raw in payload.series_urls or []:
        add(raw, None, "", None, "")

    model_ids = list(payload.model_ids or [])
    criteria = profile.criteria or {}
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
            detail="Нет series URL: укажите series_urls / model_ids или включите whitelist",
        )

    created = 0
    skipped = 0
    created_ids: list[int] = []

    for series_url, brand_id, brand_name, model_id, model_name in targets:
        try:
            links = parse_che168_listing_links(
                series_url, max_items=payload.limit_per_series
            )
        except Exception as e:
            logger.exception("discover failed for %s", series_url)
            raise HTTPException(
                status_code=502,
                detail=f"discover failed for {series_url}: {e}",
            ) from e

        for link in links:
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
            )
            if was_created and cand:
                created += 1
                db.flush()
                created_ids.append(cand.id)
            else:
                skipped += 1

    db.commit()
    candidates = []
    if created_ids:
        candidates = list(
            db.execute(
                select(ImportCandidate).where(ImportCandidate.id.in_(created_ids))
            )
            .scalars()
            .all()
        )
    return DiscoverOut(
        created=created,
        skipped_existing=skipped,
        candidates=[_candidate_out(c) for c in candidates],
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

    passed: list[ImportCandidate] = []
    rejected: list[ImportCandidate] = []
    for c in rows:
        reasons = hard_filter_candidate(c, criteria, existing_listing_ids=existing)
        if reasons:
            c.status = "filtered"
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
        if item.title is not None:
            c.title = item.title[:512]
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
    ).limit(limit)

    selected = list(db.execute(q).scalars().all())
    if not selected:
        return ApplyOut(
            applied=0,
            needed=quota.needed,
            already_today=quota.already_today,
            plan_rows=len(plan.items),
            candidates=[],
        )

    now = datetime.utcnow()
    if payload.replace_plan:
        db.execute(delete(ImportPlanItem).where(ImportPlanItem.plan_id == plan.id))
        sort_base = 0
    else:
        # Удаляем только pending без успеха, чтобы не дублировать URL агента
        existing_urls = {
            (i.url or "").strip()
            for i in plan.items
            if (i.url or "").strip()
        }
        sort_base = max((i.sort_order for i in plan.items), default=-1) + 1
        selected = [c for c in selected if (c.url or "").strip() not in existing_urls]

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
    )


@router.get("/import-plan", response_model=ImportPlanAgentOut)
def agent_get_import_plan(
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    return _import_plan_agent_out(db)


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
