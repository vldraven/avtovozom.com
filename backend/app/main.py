import os
import secrets
import shutil
import time
import uuid
import zlib
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from threading import Lock
from urllib.parse import unquote, urlparse

import httpx
from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import and_, delete, distinct, func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from .db import Base, engine, get_db, SessionLocal
from .models import (
    CalculationRequest,
    Car,
    CarBrand,
    CarGeneration,
    CarModel,
    CarPhoto,
    Chat,
    ChatMessage,
    DealerOffer,
    ModelWhitelist,
    CustomsCalcSettings,
    ParseJob,
    Role,
    User,
)
from .che168_parser import che168_detail_url_from_source_listing_id, parse_che168_detail
from .listing_copy_ru import basic_neutral_description_ru, pick_title_ru, russian_listing_title
from .model_resolver import resolve_model_id_for_listing
from .parser_logic import run_parser_job
from .translator_ru import translate_to_ru
from .email_utils import send_email
from .media_storage import delete_car_photo_files, save_chat_attachment, save_uploaded_car_photos
from .car_pricing import build_cbr_snapshot, build_pricing_guide, rub_china_for_car
from .catalog_slug import build_catalog_slug_maps, slug_for_generation_url, slugs_for_car
from .customs_calc import ensure_settings_row, run_estimate, validate_config_yaml
from .additional_expenses import (
    default_additional_expenses_json,
    parse_additional_expenses_json,
    validate_additional_expenses_json,
)
from .customs_util_json import (
    build_default_util_json_company,
    build_default_util_json_individual,
    validate_util_company_json,
    validate_util_individual_json,
)
from .schemas import (
    AdminCalculationRequestOut,
    AdminPasswordResetOut,
    AdminUserCreateIn,
    AdminUserCreateResultOut,
    AdminUserOut,
    AdminUserUpdateIn,
    CalculationRequestDealerOut,
    CalculationRequestMyOut,
    CalculationRequestOut,
    ChatMessageOut,
    ChatListItemOut,
    CarBrandBriefOut,
    CarModelBriefOut,
    CatalogBrandOut,
    CatalogModelOut,
    CatalogTreeBrandOut,
    CatalogTreeGenerationOut,
    CatalogTreeModelOut,
    CarBrandCreateIn,
    CarGenerationCreateIn,
    CarModelCreateIn,
    CarPriceBreakdownItemOut,
    CarPriceBreakdownOut,
    CbrSnapshot,
    CarOut,
    CarsListOut,
    CreateRequestIn,
    DealerOfferCreateIn,
    DealerPublicProfileOut,
    CustomsCalcConfigIn,
    CustomsCalcConfigOut,
    UtilCoeffDefaultsOut,
    CustomsCalcEstimateIn,
    CustomsCalcEstimateOut,
    DealerOfferOut,
    LoginIn,
    OpenChatOut,
    MeOut,
    CarModelCatalogIn,
    ModelWhitelistItem,
    ParseJobOut,
    ParserImportListingIn,
    PasswordChangeIn,
    ProfileUpdateIn,
    PublicRequestLeadIn,
    PublicRequestLeadOut,
    RegisterIn,
    RegisterStartOut,
    RegisterVerifyIn,
    TokenOut,
)
from .security import create_access_token, decode_access_token, hash_password, verify_password
from .seed import seed_initial_data
from .telegram_notify import notify_new_calculation_request

app = FastAPI(title="Avtovozom API", version="0.1.0")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MEDIA_ROOT = Path(os.getenv("MEDIA_ROOT", "/app/media"))
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)

_slug_maps_lock = Lock()
_slug_maps_cached_at = 0.0
_slug_maps_cached: tuple[dict[int, str], dict[tuple[int, int], str]] | None = None
_SLUG_MAPS_TTL_SECONDS = 120.0

# Календарь для возраста авто: полные годы от даты первой регистрации до сегодня (день/месяц важны).
try:
    MSK = ZoneInfo("Europe/Moscow")
except Exception:
    # В slim Docker часто нет системного tzdata; ставьте пакет tzdata (см. requirements.txt).
    MSK = timezone(timedelta(hours=3))


def _parse_car_registration_date(s: str | None) -> date | None:
    """Дата в формате YYYY-MM-DD, DD.MM.YYYY или YYYY; иначе None."""
    if s is None:
        return None
    t = (s or "").strip()
    if not t:
        return None
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(t, fmt).date()
        except ValueError:
            continue
    if len(t) == 4 and t.isdigit():
        y = int(t, 10)
        if 1980 <= y <= 2100:
            return date(y, 1, 1)
    return None


def _subtract_years_safe(d: date, years: int) -> date:
    """d - N календарных лет с безопасной обработкой 29 февраля."""
    try:
        return d.replace(year=d.year - years)
    except ValueError:
        # 29 февраля -> 28 февраля в невисокосный год
        return d.replace(year=d.year - years, day=28)


def _get_cached_slug_maps(db: Session) -> tuple[dict[int, str], dict[tuple[int, int], str]]:
    global _slug_maps_cached_at, _slug_maps_cached
    now = time.monotonic()
    with _slug_maps_lock:
        if _slug_maps_cached is not None and (now - _slug_maps_cached_at) <= _SLUG_MAPS_TTL_SECONDS:
            return _slug_maps_cached
    fresh = build_catalog_slug_maps(db)
    with _slug_maps_lock:
        _slug_maps_cached = fresh
        _slug_maps_cached_at = now
    return fresh


def _car_age_group_for_calc(car: Car) -> str:
    today = datetime.now(MSK).date()
    reg = _parse_car_registration_date(car.registration_date)
    if reg is None and car.year is not None:
        try:
            y = int(car.year)
            if 1980 <= y <= 2100:
                reg = date(y, 1, 1)
        except (TypeError, ValueError):
            reg = None
    if reg is None:
        return "new"

    # Границы по полным календарным датам (день/месяц важны):
    # new: < 1 года; 1-3: [1,3); 3-5: [3,5); 5-7: [5,7); over_7: >= 7.
    cutoff_1 = _subtract_years_safe(today, 1)
    cutoff_3 = _subtract_years_safe(today, 3)
    cutoff_5 = _subtract_years_safe(today, 5)
    cutoff_7 = _subtract_years_safe(today, 7)

    if reg > cutoff_1:
        return "new"
    if reg > cutoff_3:
        return "1-3"
    if reg > cutoff_5:
        return "3-5"
    if reg > cutoff_7:
        return "5-7"
    return "over_7"


def _car_engine_type_for_calc(car: Car) -> str:
    raw = (car.fuel_type or "").strip().lower()
    if any(token in raw for token in ("элект", "electric", "ev", "纯电", "bev")):
        return "electric"
    if "diesel" in raw or "диз" in raw:
        return "diesel"
    if any(token in raw for token in ("hybrid", "гиб", "phev", "hev", "增程")):
        return "hybrid"
    return "gasoline"


def _to_rub(amount: float, currency: str, rub_per_cny: float) -> float:
    cur = (currency or "RUB").strip().upper()
    if cur == "CNY":
        return float(amount) * float(rub_per_cny)
    return float(amount)


# Кэш компонентов ETC/ТКС: один и тот же run_estimate() для близких авто/настроек не пересчитывать.
_ETC_RUBS_CACHE: dict[
    tuple[int, str, str, int, int, int], tuple[float, float, float]
] = {}
_ETC_RUBS_LOCK = Lock()
_ETC_RUBS_CACHE_MAX = 3000


def _estimate_fingerprint(row: CustomsCalcSettings) -> int:
    h = zlib.crc32((row.config_yaml or "").encode("utf-8", errors="replace"))
    h = zlib.crc32(
        (row.util_coefficients_individual or "").encode("utf-8", errors="replace"), h
    )
    h = zlib.crc32(
        (row.util_coefficients_company or "").encode("utf-8", errors="replace"), h
    )
    return h & 0xFFFFFFFF


def _get_etc_customs_rubs(car: Car, row: CustomsCalcSettings) -> tuple[float, float, float] | None:
    engine_type = _car_engine_type_for_calc(car)
    age_group = _car_age_group_for_calc(car)
    engine_capacity = max(0, int(car.engine_volume_cc or 0))
    if engine_type != "electric":
        engine_capacity = max(50, engine_capacity)
    power = max(1, int(car.horsepower or 1))
    price_key = int(round(float(car.price_cny) * 100))
    fp = _estimate_fingerprint(row)
    key = (fp, age_group, engine_type, engine_capacity, power, price_key)
    with _ETC_RUBS_LOCK:
        hit = _ETC_RUBS_CACHE.get(key)
    if hit is not None:
        return hit
    try:
        estimate = run_estimate(
            row.config_yaml,
            CustomsCalcEstimateIn(
                age=age_group,
                engine_capacity=engine_capacity,
                engine_type=engine_type,
                power=power,
                price=float(car.price_cny),
                owner_type="individual",
                currency="CNY",
            ),
            util_individual_json=row.util_coefficients_individual,
            util_company_json=row.util_coefficients_company,
        )
        if estimate.summary is None:
            return None
        s = estimate.summary
        hit = (float(s.clearance_fee_rub), float(s.duty_rub), float(s.utilization_fee_rub))
    except Exception:
        return None
    with _ETC_RUBS_LOCK:
        if len(_ETC_RUBS_CACHE) >= _ETC_RUBS_CACHE_MAX:
            _ETC_RUBS_CACHE.clear()
        _ETC_RUBS_CACHE[key] = hit
    return hit


def _compute_estimated_total_rub(
    car: Car, row: CustomsCalcSettings, cbr: CbrSnapshot
) -> float | None:
    rubs = _get_etc_customs_rubs(car, row)
    if rubs is None:
        return None
    clearance, duty, util = rubs
    rub_china = float(rub_china_for_car(car, cbr))
    extras = parse_additional_expenses_json(row.additional_expenses_json)
    export_raw = extras["export_expenses"]
    russia_raw = extras["russia_expenses"]
    bank_raw = extras["bank_commission"]
    company_raw = extras["company_commission"]
    export_rub = _to_rub(float(export_raw["amount"]), str(export_raw["currency"]), cbr.rub_per_cny)
    russia_rub = _to_rub(float(russia_raw["amount"]), str(russia_raw["currency"]), cbr.rub_per_cny)
    company_rub = _to_rub(float(company_raw["amount"]), str(company_raw["currency"]), cbr.rub_per_cny)
    bank_rub = rub_china * (float(bank_raw["percent"]) / 100.0)
    total = (
        rub_china
        + clearance
        + duty
        + util
        + export_rub
        + russia_rub
        + bank_rub
        + company_rub
    )
    return round(float(total), 2)


def _build_car_price_breakdown(
    car: Car,
    *,
    row: CustomsCalcSettings,
    cbr: CbrSnapshot | None,
) -> CarPriceBreakdownOut | None:
    if cbr is None:
        return None

    rub_china = float(rub_china_for_car(car, cbr))
    engine_type = _car_engine_type_for_calc(car)
    age_group = _car_age_group_for_calc(car)

    rubs = _get_etc_customs_rubs(car, row)
    if rubs is None:
        return None
    clearance, duty, util = rubs

    extras = parse_additional_expenses_json(row.additional_expenses_json)
    export_raw = extras["export_expenses"]
    russia_raw = extras["russia_expenses"]
    bank_raw = extras["bank_commission"]
    company_raw = extras["company_commission"]

    export_rub = _to_rub(float(export_raw["amount"]), str(export_raw["currency"]), cbr.rub_per_cny)
    russia_rub = _to_rub(float(russia_raw["amount"]), str(russia_raw["currency"]), cbr.rub_per_cny)
    company_rub = _to_rub(float(company_raw["amount"]), str(company_raw["currency"]), cbr.rub_per_cny)
    bank_rub = rub_china * (float(bank_raw["percent"]) / 100.0)

    items = [
        CarPriceBreakdownItemOut(
            key="china_price",
            label="Стоимость в Китае по курсу",
            amount_rub=round(rub_china, 2),
            description=f"{float(car.price_cny):,.0f} ¥ по курсу ЦБ".replace(",", " "),
        ),
        CarPriceBreakdownItemOut(
            key="clearance_fee",
            label="Таможенное оформление",
            amount_rub=round(clearance, 2),
            description="Таможенный сбор за оформление.",
        ),
        CarPriceBreakdownItemOut(
            key="duty",
            label="Таможенная пошлина",
            amount_rub=round(duty, 2),
            description="Расчет по параметрам автомобиля и возрастной группе.",
        ),
        CarPriceBreakdownItemOut(
            key="utilization_fee",
            label="Утилизационный сбор",
            amount_rub=round(util, 2),
            description="По таблицам коэффициентов, заданным в админке.",
        ),
        CarPriceBreakdownItemOut(
            key="export_expenses",
            label="Расходы в стране экспорта",
            amount_rub=round(export_rub, 2),
            description=str(export_raw["description"]),
        ),
        CarPriceBreakdownItemOut(
            key="russia_expenses",
            label="Расходы в России",
            amount_rub=round(russia_rub, 2),
            description=str(russia_raw["description"]),
        ),
        CarPriceBreakdownItemOut(
            key="bank_commission",
            label="Комиссия банка за перевод",
            amount_rub=round(bank_rub, 2),
            description=str(bank_raw["description"]),
        ),
        CarPriceBreakdownItemOut(
            key="company_commission",
            label="Комиссия компании",
            amount_rub=round(company_rub, 2),
            description=str(company_raw["description"]),
        ),
    ]
    total_rub = sum(float(i.amount_rub) for i in items)
    return CarPriceBreakdownOut(
        total_rub=round(total_rub, 2),
        owner_type="individual",
        age_group=age_group,
        engine_type_calc=engine_type,
        components=items,
    )


def _car_to_out(
    car: Car,
    *,
    cbr: CbrSnapshot | None,
    full_import: bool = False,
    has_public_dealer_profile: bool = False,
    slug_maps: tuple[dict[int, str], dict[tuple[int, int], str]],
    price_breakdown: CarPriceBreakdownOut | None = None,
    estimated_total_rub: float | None = None,
) -> CarOut:
    rub = round(rub_china_for_car(car, cbr), 2) if cbr is not None else None
    guide = build_pricing_guide(car, cbr) if full_import and cbr is not None else None
    brand_slug, model_slug = slugs_for_car(car, slug_maps[0], slug_maps[1])
    gen = getattr(car, "generation", None)
    gen_slug = (gen.slug if gen is not None else "") or ""
    est = estimated_total_rub
    if est is None and price_breakdown is not None:
        est = float(price_breakdown.total_rub)
    return CarOut(
        id=car.id,
        brand_id=car.brand_id,
        model_id=car.model_id,
        generation_id=car.generation_id,
        brand_slug=brand_slug,
        model_slug=model_slug,
        generation_slug=gen_slug,
        generation=(gen.name if gen is not None else None),
        title=car.title,
        description=car.description,
        year=car.year,
        mileage_km=car.mileage_km,
        engine_volume_cc=car.engine_volume_cc,
        horsepower=car.horsepower,
        fuel_type=car.fuel_type,
        transmission=car.transmission,
        location_city=car.location_city,
        price_cny=car.price_cny,
        registration_date=car.registration_date,
        production_date=car.production_date,
        brand=car.brand.name,
        model=car.model.name,
        created_by_user_id=car.created_by_user_id,
        has_public_dealer_profile=has_public_dealer_profile,
        photos=car.photos,
        rub_china=rub,
        pricing_guide=guide,
        price_breakdown=price_breakdown,
        estimated_total_rub=est,
    )


_MAX_PROXY_IMAGE_BYTES = 15 * 1024 * 1024
_PROXY_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def _allowed_image_proxy_host(host: str) -> bool:
    if not host:
        return False
    h = host.lower()
    if h.endswith(".che168.com") or h == "che168.com":
        return True
    if h.endswith(".autohome.com.cn") or h.endswith("autohome.com.cn"):
        return True
    if "2scimg" in h or "escimg" in h:
        return True
    return False


@app.get("/media-proxy")
def media_proxy(url: str = Query(..., max_length=4096)):
    """
    Прокси картинок с che168/autohome: браузер не может загрузить CDN напрямую (hotlink),
    сервер запрашивает изображение с нужным Referer.
    """
    raw = unquote(url).strip()
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Invalid URL scheme")
    if not _allowed_image_proxy_host(parsed.hostname or ""):
        raise HTTPException(status_code=400, detail="Host not allowed for image proxy")
    headers = {
        "User-Agent": _PROXY_UA,
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Referer": "https://www.che168.com/",
        "Accept-Language": "zh-CN,zh;q=0.9",
    }
    try:
        with httpx.Client(timeout=60.0, follow_redirects=True, headers=headers) as client:
            r = client.get(raw)
            r.raise_for_status()
            body = r.content
            ct_raw = r.headers.get("content-type") or "image/jpeg"
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Upstream image error: {e!s}") from e
    if len(body) > _MAX_PROXY_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image too large")
    ct = ct_raw.split(";")[0].strip()
    if "text/html" in ct or "text/" in ct:
        raise HTTPException(status_code=400, detail="URL did not return an image")
    return Response(content=body, media_type=ct)


app.mount("/media", StaticFiles(directory=str(MEDIA_ROOT)), name="media")


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE calculation_requests "
                "ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)"
            )
        )
        conn.execute(
            text("ALTER TABLE car_models ADD COLUMN IF NOT EXISTS che168_url VARCHAR(512)")
        )
        conn.execute(
            text("ALTER TABLE cars ADD COLUMN IF NOT EXISTS mileage_km INTEGER")
        )
        conn.execute(
            text("ALTER TABLE cars ADD COLUMN IF NOT EXISTS fuel_type VARCHAR(64)")
        )
        conn.execute(
            text("ALTER TABLE cars ADD COLUMN IF NOT EXISTS transmission VARCHAR(64)")
        )
        conn.execute(
            text("ALTER TABLE cars ADD COLUMN IF NOT EXISTS location_city VARCHAR(128)")
        )
        conn.execute(
            text("ALTER TABLE cars ADD COLUMN IF NOT EXISTS registration_date VARCHAR(32)")
        )
        conn.execute(
            text("ALTER TABLE cars ADD COLUMN IF NOT EXISTS production_date VARCHAR(32)")
        )
        conn.execute(
            text(
                "ALTER TABLE cars ADD COLUMN IF NOT EXISTS created_by_user_id "
                "INTEGER REFERENCES users(id)"
            )
        )
        conn.execute(
            text(
                "ALTER TABLE cars ADD COLUMN IF NOT EXISTS generation_id "
                "INTEGER REFERENCES car_generations(id)"
            )
        )
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_cars_generation_id ON cars (generation_id)")
        )
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(32)"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT TRUE"))
        conn.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE")
        )
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_code VARCHAR(16)"))
        conn.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMP NULL")
        )
        conn.execute(text("UPDATE users SET email_verified = TRUE WHERE email_verified IS NULL"))
        conn.execute(text("UPDATE users SET must_change_password = FALSE WHERE must_change_password IS NULL"))
        conn.execute(
            text(
                "ALTER TABLE calculation_requests "
                "ADD COLUMN IF NOT EXISTS offers_seen_at TIMESTAMP NULL"
            )
        )
        conn.execute(
            text(
                """
                UPDATE calculation_requests cr
                SET offers_seen_at = sub.last_offer
                FROM (
                    SELECT request_id, MAX(created_at) AS last_offer
                    FROM dealer_offers
                    GROUP BY request_id
                ) sub
                WHERE cr.id = sub.request_id AND cr.offers_seen_at IS NULL
                """
            )
        )
        conn.execute(text("ALTER TABLE car_generations ADD COLUMN IF NOT EXISTS year_from INTEGER"))
        conn.execute(text("ALTER TABLE car_generations ADD COLUMN IF NOT EXISTS year_to INTEGER"))
        conn.execute(
            text(
                "ALTER TABLE parse_jobs ADD COLUMN IF NOT EXISTS import_model_id INTEGER REFERENCES car_models(id)"
            )
        )
        conn.execute(
            text(
                "ALTER TABLE parse_jobs ADD COLUMN IF NOT EXISTS import_detail_url VARCHAR(2048)"
            )
        )
        conn.execute(
            text(
                "ALTER TABLE customs_calc_settings ADD COLUMN IF NOT EXISTS "
                "util_coefficients_individual TEXT"
            )
        )
        conn.execute(
            text(
                "ALTER TABLE customs_calc_settings ADD COLUMN IF NOT EXISTS "
                "util_coefficients_company TEXT"
            )
        )
        conn.execute(
            text(
                "ALTER TABLE customs_calc_settings ADD COLUMN IF NOT EXISTS "
                "additional_expenses_json TEXT"
            )
        )
    db = next(get_db())
    try:
        seed_initial_data(db)
        ensure_settings_row(db)
    finally:
        db.close()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/public/customs-calculator/estimate", response_model=CustomsCalcEstimateOut)
def public_customs_calculator_estimate(payload: CustomsCalcEstimateIn, db: Session = Depends(get_db)):
    row = ensure_settings_row(db)
    try:
        out = run_estimate(
            row.config_yaml,
            payload,
            util_individual_json=row.util_coefficients_individual,
            util_company_json=row.util_coefficients_company,
        )
        return out
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Ошибка расчёта: {e}") from e


@app.get("/catalog/brands", response_model=list[CatalogBrandOut])
def public_catalog_brands(db: Session = Depends(get_db)):
    """Публичный список марок с числом объявлений (главная страница, сценарий как на auto.ru)."""
    brands = db.execute(select(CarBrand).order_by(CarBrand.name)).scalars().all()
    bmap, _ = _get_cached_slug_maps(db)
    car_counts = {
        row[0]: row[1]
        for row in db.execute(
            select(Car.brand_id, func.count(Car.id))
            .where(Car.is_active.is_(True))
            .group_by(Car.brand_id)
        ).all()
    }
    model_counts = {
        row[0]: row[1]
        for row in db.execute(
            select(Car.brand_id, func.count(distinct(Car.model_id)))
            .where(Car.is_active.is_(True))
            .group_by(Car.brand_id)
        ).all()
    }
    items = [
        CatalogBrandOut(
            id=b.id,
            name=b.name,
            slug=bmap.get(b.id, ""),
            listings_count=car_counts.get(b.id, 0),
            models_with_listings=model_counts.get(b.id, 0),
        )
        for b in brands
    ]
    items.sort(key=lambda x: (-x.listings_count, x.name.lower()))
    return items


@app.get("/catalog/models", response_model=list[CatalogModelOut])
def public_catalog_models(brand_id: int = Query(...), db: Session = Depends(get_db)):
    brand = db.execute(select(CarBrand).where(CarBrand.id == brand_id)).scalar_one_or_none()
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")
    models = (
        db.execute(
            select(CarModel)
            .where(CarModel.brand_id == brand_id)
            .order_by(CarModel.name)
        )
        .scalars()
        .all()
    )
    _, mmap = _get_cached_slug_maps(db)
    counts = {
        row[0]: row[1]
        for row in db.execute(
            select(Car.model_id, func.count(Car.id))
            .where(Car.is_active.is_(True), Car.brand_id == brand_id)
            .group_by(Car.model_id)
        ).all()
    }
    return [
        CatalogModelOut(
            id=m.id,
            brand_id=m.brand_id,
            name=m.name,
            slug=mmap.get((brand_id, m.id), ""),
            listings_count=counts.get(m.id, 0),
        )
        for m in models
    ]


@app.get("/catalog/tree", response_model=list[CatalogTreeBrandOut])
def public_catalog_tree(db: Session = Depends(get_db)):
    """Дерево марок и моделей с ЧПУ-слагами для навигации /catalog/…"""
    brands = db.execute(select(CarBrand).order_by(CarBrand.name)).scalars().all()
    bmap, mmap = _get_cached_slug_maps(db)
    car_counts = {
        row[0]: row[1]
        for row in db.execute(
            select(Car.brand_id, func.count(Car.id))
            .where(Car.is_active.is_(True))
            .group_by(Car.brand_id)
        ).all()
    }
    model_distinct = {
        row[0]: row[1]
        for row in db.execute(
            select(Car.brand_id, func.count(distinct(Car.model_id)))
            .where(Car.is_active.is_(True))
            .group_by(Car.brand_id)
        ).all()
    }
    listing_per_model = {
        (row[0], row[1]): row[2]
        for row in db.execute(
            select(Car.brand_id, Car.model_id, func.count(Car.id))
            .where(Car.is_active.is_(True))
            .group_by(Car.brand_id, Car.model_id)
        ).all()
    }
    listing_per_generation = {
        row[0]: row[1]
        for row in db.execute(
            select(Car.generation_id, func.count(Car.id))
            .where(Car.is_active.is_(True), Car.generation_id.isnot(None))
            .group_by(Car.generation_id)
        ).all()
    }
    out: list[CatalogTreeBrandOut] = []
    for b in brands:
        models = (
            db.execute(
                select(CarModel)
                .where(CarModel.brand_id == b.id)
                .order_by(CarModel.name)
            )
            .scalars()
            .all()
        )
        model_items: list[CatalogTreeModelOut] = []
        for m in models:
            gens = (
                db.execute(
                    select(CarGeneration)
                    .where(CarGeneration.model_id == m.id)
                    .order_by(CarGeneration.name)
                )
                .scalars()
                .all()
            )
            gen_items = [
                CatalogTreeGenerationOut(
                    id=g.id,
                    name=g.name,
                    slug=g.slug,
                    listings_count=listing_per_generation.get(g.id, 0),
                )
                for g in gens
            ]
            model_items.append(
                CatalogTreeModelOut(
                    id=m.id,
                    name=m.name,
                    slug=mmap.get((b.id, m.id), ""),
                    listings_count=listing_per_model.get((b.id, m.id), 0),
                    generations=gen_items,
                )
            )
        out.append(
            CatalogTreeBrandOut(
                id=b.id,
                name=b.name,
                slug=bmap.get(b.id, ""),
                listings_count=car_counts.get(b.id, 0),
                models_with_listings=model_distinct.get(b.id, 0),
                models=model_items,
            )
        )
    out.sort(key=lambda x: (-x.listings_count, x.name.lower()))
    return out


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    user_id_str = decode_access_token(token)
    if not user_id_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    user = (
        db.execute(
            select(User).where(User.id == int(user_id_str)).options(joinedload(User.role))
        )
        .unique()
        .scalar_one_or_none()
    )
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User is not active",
        )
    return user


def require_roles(*allowed_roles: str):
    def _checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role.code not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions"
            )
        return current_user

    return _checker


def _upsert_unverified_user_send_code(
    db: Session,
    *,
    email: str,
    phone: str,
    full_name: str,
    email_subject: str,
    email_body: str,
    verified_exists_detail: str = "Этот email уже зарегистрирован. Войдите в аккаунт.",
) -> User:
    """
    Создаёт или обновляет пользователя, ожидающего подтверждения email, и отправляет код.
    email_body должен содержать плейсхолдер {code}.
    """
    exists = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if exists and exists.email_verified:
        raise HTTPException(status_code=400, detail=verified_exists_detail)
    user_role = db.execute(select(Role).where(Role.code == "user")).scalar_one()
    code = f"{secrets.randbelow(900000) + 100000}"
    expires = datetime.now(timezone.utc) + timedelta(minutes=15)
    if exists:
        exists.phone = phone or exists.phone
        exists.full_name = full_name or exists.full_name
        exists.role_id = user_role.id
        exists.is_active = False
        exists.email_verified = False
        exists.verification_code = code
        exists.verification_expires_at = expires
    else:
        db.add(
            User(
                email=email,
                phone=phone or None,
                password_hash=hash_password(secrets.token_urlsafe(10)),
                full_name=full_name or "",
                role_id=user_role.id,
                is_active=False,
                email_verified=False,
                must_change_password=True,
                verification_code=code,
                verification_expires_at=expires,
            )
        )
    db.commit()
    send_email(email, email_subject, email_body.format(code=code))
    return db.execute(select(User).where(User.email == email)).scalar_one()


@app.post("/auth/register", response_model=TokenOut)
def register(payload: RegisterIn, db: Session = Depends(get_db)):
    # Backward-compatible one-step registration for integrations.
    exists = db.execute(select(User).where(User.email == payload.email.lower())).scalar_one_or_none()
    if exists and exists.email_verified:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_role = db.execute(select(Role).where(Role.code == "user")).scalar_one()
    generated_password = secrets.token_urlsafe(8)
    code = f"{secrets.randbelow(900000) + 100000}"
    expires = datetime.now(timezone.utc) + timedelta(minutes=15)
    if exists:
        exists.phone = payload.phone
        exists.full_name = payload.full_name or exists.full_name
        exists.password_hash = hash_password(generated_password)
        exists.role_id = user_role.id
        exists.is_active = False
        exists.email_verified = False
        exists.must_change_password = True
        exists.verification_code = code
        exists.verification_expires_at = expires
        db.commit()
        db.refresh(exists)
        send_email(
            exists.email,
            "Код подтверждения avtovozom",
            f"Ваш код подтверждения: {code}\nСрок действия: 15 минут.",
        )
        raise HTTPException(
            status_code=202,
            detail="Код подтверждения отправлен на email. Подтвердите регистрацию.",
        )
    user = User(
        email=payload.email.lower(),
        phone=payload.phone,
        password_hash=hash_password(generated_password),
        full_name=payload.full_name,
        role_id=user_role.id,
        is_active=False,
        email_verified=False,
        must_change_password=True,
        verification_code=code,
        verification_expires_at=expires,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    send_email(
        user.email,
        "Код подтверждения avtovozom",
        f"Ваш код подтверждения: {code}\nСрок действия: 15 минут.",
    )
    raise HTTPException(
        status_code=202,
        detail="Код подтверждения отправлен на email. Подтвердите регистрацию.",
    )


@app.post("/auth/register/start", response_model=RegisterStartOut)
def register_start(payload: RegisterIn, db: Session = Depends(get_db)):
    _upsert_unverified_user_send_code(
        db,
        email=payload.email.lower(),
        phone=payload.phone.strip(),
        full_name=payload.full_name or "",
        email_subject="Код подтверждения avtovozom",
        email_body="Ваш код подтверждения: {code}\nСрок действия: 15 минут.",
        verified_exists_detail="Этот email уже зарегистрирован.",
    )
    return RegisterStartOut(ok=True, message="Код отправлен на email")


@app.post("/auth/register/verify", response_model=RegisterStartOut)
def register_verify(payload: RegisterVerifyIn, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.email == payload.email.lower())).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    code_in = (payload.code or "").strip()
    if not user.email_verified:
        if not user.verification_code or user.verification_code != code_in:
            raise HTTPException(status_code=400, detail="Неверный код подтверждения")
        if not user.verification_expires_at or user.verification_expires_at < now:
            raise HTTPException(status_code=400, detail="Код подтверждения истек")
        temp_password = secrets.token_urlsafe(8)
        user.password_hash = hash_password(temp_password)
        user.email_verified = True
        user.is_active = True
        user.must_change_password = True
        user.verification_code = None
        user.verification_expires_at = None
        db.commit()
        send_email(
            user.email,
            "Временный пароль avtovozom",
            "Ваш email подтвержден.\n"
            f"Временный пароль для входа: {temp_password}\n"
            "После входа смените пароль в профиле.",
        )
        token = create_access_token(str(user.id))
        return RegisterStartOut(
            ok=True,
            message=(
                "Email подтвержден. Временный пароль отправлен на почту. "
                "Вы автоматически вошли в аккаунт."
            ),
            access_token=token,
        )
    if not user.verification_code:
        return RegisterStartOut(ok=True, message="Email уже подтвержден")
    if not user.verification_expires_at or user.verification_expires_at < now:
        user.verification_code = None
        user.verification_expires_at = None
        db.commit()
        raise HTTPException(status_code=400, detail="Код подтверждения истек")
    if user.verification_code != code_in:
        raise HTTPException(status_code=400, detail="Неверный код подтверждения")
    user.verification_code = None
    user.verification_expires_at = None
    db.commit()
    token = create_access_token(str(user.id))
    return RegisterStartOut(
        ok=True,
        message="Код подтверждён. Вы вошли в аккаунт.",
        access_token=token,
    )


@app.post("/auth/login", response_model=TokenOut)
def login(payload: LoginIn, db: Session = Depends(get_db)):
    raw = payload.email.strip()
    user = None
    if "@" in raw:
        user = db.execute(select(User).where(User.email == raw.lower())).scalar_one_or_none()
    else:
        digits = "".join(c for c in raw if c.isdigit())
        if digits:
            phone_norm = func.regexp_replace(User.phone, "[^0-9]", "", "g")
            user = db.execute(
                select(User).where(and_(User.phone.isnot(None), phone_norm == digits))
            ).scalar_one_or_none()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.email_verified:
        raise HTTPException(status_code=403, detail="Email is not verified")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User is not active")
    token = create_access_token(str(user.id))
    return TokenOut(access_token=token)


@app.get("/auth/me", response_model=MeOut)
def me(current_user: User = Depends(get_current_user)):
    return MeOut(
        id=current_user.id,
        email=current_user.email,
        phone=current_user.phone,
        full_name=current_user.full_name,
        display_name=current_user.display_name or "",
        company_name=current_user.company_name,
        role=current_user.role.code,
        email_verified=current_user.email_verified,
        must_change_password=current_user.must_change_password,
    )


@app.patch("/profile", response_model=MeOut)
def update_profile(
    payload: ProfileUpdateIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.full_name is not None:
        current_user.full_name = payload.full_name.strip()
    if payload.phone is not None:
        current_user.phone = payload.phone.strip() or None
    if payload.display_name is not None:
        current_user.display_name = payload.display_name.strip()[:128]
    if payload.company_name is not None:
        if current_user.role.code != "dealer":
            raise HTTPException(
                status_code=400,
                detail="Название компании доступно только для роли «дилер».",
            )
        s = payload.company_name.strip()
        current_user.company_name = s[:255] if s else None
    db.commit()
    db.refresh(current_user)
    return MeOut(
        id=current_user.id,
        email=current_user.email,
        phone=current_user.phone,
        full_name=current_user.full_name,
        display_name=current_user.display_name or "",
        company_name=current_user.company_name,
        role=current_user.role.code,
        email_verified=current_user.email_verified,
        must_change_password=current_user.must_change_password,
    )


@app.post("/profile/password")
def change_profile_password(
    payload: PasswordChangeIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(payload.old_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Old password is incorrect")
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 chars")
    current_user.password_hash = hash_password(payload.new_password)
    current_user.must_change_password = False
    db.commit()
    return {"ok": True}


@app.get("/cars", response_model=CarsListOut)
def list_cars(
    q: str | None = Query(default=None),
    brand_id: int | None = None,
    model_id: int | None = None,
    generation_id: int | None = None,
    year_from: int | None = None,
    year_to: int | None = None,
    engine_from: int | None = None,
    engine_to: int | None = None,
    hp_from: int | None = None,
    hp_to: int | None = None,
    manufacturer: str | None = None,
    sort: str | None = Query(
        default="date_desc",
        description="date_desc|date_asc|price_asc|price_desc",
    ),
    include_breakdown: bool = Query(
        default=False,
        description="Если true — считать ориентировочную детализацию итоговой цены (тяжелее).",
    ),
    page: int = 1,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    stmt = (
        select(Car)
        .options(
            joinedload(Car.brand),
            joinedload(Car.model),
            joinedload(Car.generation),
            joinedload(Car.photos),
        )
        .where(Car.is_active.is_(True))
    )
    qs = (q or "").strip()
    man = (manufacturer or "").strip()

    if qs:
        stmt = (
            stmt.join(CarBrand, Car.brand_id == CarBrand.id)
            .join(CarModel, Car.model_id == CarModel.id)
            .where(
                or_(
                    Car.title.ilike(f"%{qs}%"),
                    Car.description.ilike(f"%{qs}%"),
                    CarBrand.name.ilike(f"%{qs}%"),
                    CarModel.name.ilike(f"%{qs}%"),
                )
            )
        )
    elif man:
        stmt = stmt.join(CarBrand, Car.brand_id == CarBrand.id).where(
            CarBrand.name.ilike(f"%{man}%")
        )

    if brand_id is not None:
        stmt = stmt.where(Car.brand_id == brand_id)
    if model_id is not None:
        stmt = stmt.where(Car.model_id == model_id)
    if generation_id is not None:
        stmt = stmt.where(Car.generation_id == generation_id)

    if year_from is not None:
        stmt = stmt.where(Car.year >= year_from)
    if year_to is not None:
        stmt = stmt.where(Car.year <= year_to)
    if engine_from is not None:
        stmt = stmt.where(Car.engine_volume_cc >= engine_from)
    if engine_to is not None:
        stmt = stmt.where(Car.engine_volume_cc <= engine_to)
    if hp_from is not None:
        stmt = stmt.where(Car.horsepower >= hp_from)
    if hp_to is not None:
        stmt = stmt.where(Car.horsepower <= hp_to)

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    s = (sort or "date_desc").strip().lower()
    if s == "price_asc":
        order = (Car.price_cny.asc(), Car.id.desc())
    elif s == "price_desc":
        order = (Car.price_cny.desc(), Car.id.desc())
    elif s == "date_asc":
        order = (Car.created_at.asc(), Car.id.asc())
    else:
        order = (Car.created_at.desc(), Car.id.desc())
    cars = db.execute(
        stmt.order_by(*order)
        .offset((page - 1) * limit)
        .limit(limit)
    ).unique().scalars().all()

    snap, cbr_err = build_cbr_snapshot()
    slug_maps = _get_cached_slug_maps(db)
    settings_row = ensure_settings_row(db)
    items: list[CarOut] = []
    for car in cars:
        pb = None
        if include_breakdown:
            try:
                pb = _build_car_price_breakdown(car, row=settings_row, cbr=snap)
            except Exception:
                pb = None
        est: float | None = None
        if pb is not None:
            est = float(pb.total_rub)
        elif snap is not None:
            try:
                est = _compute_estimated_total_rub(car, settings_row, snap)
            except Exception:
                est = None
        items.append(
            _car_to_out(
                car,
                cbr=snap,
                full_import=False,
                slug_maps=slug_maps,
                price_breakdown=pb,
                estimated_total_rub=est,
            )
        )
    return CarsListOut(items=items, total=total, cbr=snap, cbr_error=cbr_err)


@app.get("/cars/{car_id}", response_model=CarOut)
def get_car(car_id: int, db: Session = Depends(get_db)):
    car = db.execute(
        select(Car)
        .options(
            joinedload(Car.brand),
            joinedload(Car.model),
            joinedload(Car.generation),
            joinedload(Car.photos),
        )
        .where(Car.id == car_id, Car.is_active.is_(True))
    ).unique().scalar_one_or_none()
    if not car:
        raise HTTPException(status_code=404, detail="Car not found")
    has_pub = False
    if car.created_by_user_id is not None:
        seller = (
            db.execute(
                select(User)
                .where(User.id == car.created_by_user_id)
                .options(joinedload(User.role))
            )
            .unique()
            .scalar_one_or_none()
        )
        has_pub = bool(seller and seller.role and seller.role.code == "dealer")
    snap, _ = build_cbr_snapshot()
    settings_row = ensure_settings_row(db)
    price_breakdown = None
    try:
        price_breakdown = _build_car_price_breakdown(car, row=settings_row, cbr=snap)
    except Exception:
        price_breakdown = None
    est: float | None = None
    if price_breakdown is not None:
        est = float(price_breakdown.total_rub)
    elif snap is not None:
        try:
            est = _compute_estimated_total_rub(car, settings_row, snap)
        except Exception:
            est = None
    slug_maps = _get_cached_slug_maps(db)
    return _car_to_out(
        car,
        cbr=snap,
        full_import=bool(snap),
        has_public_dealer_profile=has_pub,
        slug_maps=slug_maps,
        price_breakdown=price_breakdown,
        estimated_total_rub=est,
    )


@app.get("/public/dealers/{user_id}", response_model=DealerPublicProfileOut)
def public_dealer_profile(user_id: int, db: Session = Depends(get_db)):
    user = (
        db.execute(select(User).where(User.id == user_id).options(joinedload(User.role)))
        .unique()
        .scalar_one_or_none()
    )
    if not user or not user.is_active or user.role.code != "dealer":
        raise HTTPException(status_code=404, detail="Dealer not found")

    stmt = (
        select(Car)
        .options(
            joinedload(Car.brand),
            joinedload(Car.model),
            joinedload(Car.generation),
            joinedload(Car.photos),
        )
        .where(Car.created_by_user_id == user_id, Car.is_active.is_(True))
        .order_by(Car.updated_at.desc())
        .limit(100)
    )
    cars = db.execute(stmt).unique().scalars().all()
    snap, _ = build_cbr_snapshot()
    slug_maps = _get_cached_slug_maps(db)
    settings_row = ensure_settings_row(db)
    items: list[CarOut] = []
    for c in cars:
        est: float | None = None
        if snap is not None:
            try:
                est = _compute_estimated_total_rub(c, settings_row, snap)
            except Exception:
                est = None
        items.append(
            _car_to_out(
                c,
                cbr=snap,
                full_import=False,
                slug_maps=slug_maps,
                price_breakdown=None,
                estimated_total_rub=est,
            )
        )
    co = (user.company_name or "").strip()
    dn = (user.display_name or "").strip()
    fn = (user.full_name or "").strip()
    headline = co or dn or fn or user.email
    return DealerPublicProfileOut(
        user_id=user.id,
        display_name=user.display_name or "",
        company_name=user.company_name,
        headline=headline,
        listings_total=len(items),
        cars=items,
    )


_MAX_STAFF_UPLOAD_BYTES = 10 * 1024 * 1024


def _optional_mileage(mileage_km_raw: str | None) -> int | None:
    if mileage_km_raw is None:
        return None
    s = str(mileage_km_raw).strip()
    if not s:
        return None
    try:
        return int(s)
    except ValueError:
        raise HTTPException(
            status_code=400, detail="mileage_km must be an integer"
        ) from None


def _optional_generation_id_form(raw: str | None) -> int | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    try:
        return int(s)
    except ValueError:
        raise HTTPException(
            status_code=400, detail="generation_id must be an integer"
        ) from None


def _assert_generation_belongs_to_model(
    db: Session, generation_id: int | None, model_id: int
) -> None:
    if generation_id is None:
        return
    g = db.execute(
        select(CarGeneration).where(CarGeneration.id == generation_id)
    ).scalar_one_or_none()
    if not g or g.model_id != model_id:
        raise HTTPException(
            status_code=400, detail="generation_id does not match model_id"
        )


def _allocate_generation_slug(db: Session, model_id: int, display_name: str) -> str:
    base = slug_for_generation_url(display_name)
    used = set(
        db.execute(
            select(CarGeneration.slug).where(CarGeneration.model_id == model_id)
        ).scalars().all()
    )
    cand = base
    n = 0
    while cand in used:
        n += 1
        cand = f"{base}-{n}"
    return cand


async def _update_car_from_multipart(
    db: Session,
    car: Car,
    car_id: int,
    *,
    brand_id: int,
    model_id: int,
    generation_id: int | None,
    title: str,
    description: str,
    year: int,
    mileage_km: str | None,
    engine_volume_cc: int,
    horsepower: int,
    fuel_type: str | None,
    transmission: str | None,
    location_city: str | None,
    price_cny: float,
    registration_date: str | None,
    production_date: str | None,
    photos: list[UploadFile] | None,
    remove_photo_ids: str | None = None,
) -> CarOut:
    model_row = db.execute(
        select(CarModel).where(CarModel.id == model_id)
    ).scalar_one_or_none()
    if not model_row or model_row.brand_id != brand_id:
        raise HTTPException(
            status_code=400, detail="model_id does not match brand_id"
        )
    _assert_generation_belongs_to_model(db, generation_id, model_id)

    upload_list = list(photos or [])
    if len(upload_list) > 15:
        raise HTTPException(status_code=400, detail="Too many photos (max 15)")

    blobs: list[bytes] = []
    for uf in upload_list:
        data = await uf.read()
        if len(data) > _MAX_STAFF_UPLOAD_BYTES:
            raise HTTPException(
                status_code=400, detail="Each photo must be at most 10 MB"
            )
        blobs.append(data)

    car.brand_id = brand_id
    car.model_id = model_id
    car.generation_id = generation_id
    car.title = title.strip() or "Без названия"
    car.description = (description or "").strip()
    car.year = year
    car.mileage_km = _optional_mileage(mileage_km)
    car.engine_volume_cc = engine_volume_cc
    car.horsepower = horsepower
    car.fuel_type = (fuel_type or "").strip() or None
    car.transmission = (transmission or "").strip() or None
    car.location_city = (location_city or "").strip() or None
    car.price_cny = float(price_cny)
    car.registration_date = (registration_date or "").strip() or None
    car.production_date = (production_date or "").strip() or None

    raw_rm = (remove_photo_ids or "").strip()
    if raw_rm:
        id_list: list[int] = []
        for part in raw_rm.split(","):
            part = part.strip()
            if part.isdigit():
                id_list.append(int(part))
        if id_list:
            ph_rows = (
                db.execute(
                    select(CarPhoto).where(
                        CarPhoto.car_id == car.id,
                        CarPhoto.id.in_(id_list),
                    )
                )
                .scalars()
                .all()
            )
            urls_rm = [p.storage_url for p in ph_rows]
            for p in ph_rows:
                db.delete(p)
            db.flush()
            delete_car_photo_files(car_id, urls_rm)

    if blobs:
        db.execute(delete(CarPhoto).where(CarPhoto.car_id == car.id))
        db.commit()
        car_dir = MEDIA_ROOT / "cars" / str(car_id)
        if car_dir.is_dir():
            try:
                shutil.rmtree(car_dir)
            except OSError:
                pass
        paths = save_uploaded_car_photos(car.id, blobs)
        if not paths:
            raise HTTPException(
                status_code=400,
                detail="No valid image files (use JPEG, PNG, WebP, or GIF)",
            )
        for i, url in enumerate(paths):
            db.add(CarPhoto(car_id=car.id, storage_url=url, sort_order=i))
        db.commit()
    else:
        db.commit()

    car = (
        db.execute(
            select(Car)
            .options(
                joinedload(Car.brand),
                joinedload(Car.model),
                joinedload(Car.generation),
                joinedload(Car.photos),
            )
            .where(Car.id == car_id)
        )
        .unique()
        .scalar_one()
    )
    snap, _ = build_cbr_snapshot()
    slug_maps = _get_cached_slug_maps(db)
    return _car_to_out(car, cbr=snap, full_import=bool(snap), slug_maps=slug_maps)


@app.get("/staff/catalog/brands", response_model=list[CarBrandBriefOut])
def staff_catalog_brands(
    response: Response,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "moderator", "dealer")),
):
    response.headers["Cache-Control"] = "no-store"
    return db.execute(select(CarBrand).order_by(CarBrand.name)).scalars().all()


@app.get("/staff/catalog/models", response_model=list[CarModelBriefOut])
def staff_catalog_models(
    response: Response,
    brand_id: int = Query(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "moderator", "dealer")),
):
    response.headers["Cache-Control"] = "no-store"
    return (
        db.execute(
            select(CarModel)
            .where(CarModel.brand_id == brand_id)
            .order_by(CarModel.name)
        )
        .scalars()
        .all()
    )


@app.get(
    "/staff/catalog/generations",
    response_model=list[CatalogTreeGenerationOut],
)
def staff_catalog_generations(
    response: Response,
    model_id: int = Query(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "moderator", "dealer")),
):
    listing_per_generation = {
        row[0]: row[1]
        for row in db.execute(
            select(Car.generation_id, func.count(Car.id))
            .where(Car.is_active.is_(True), Car.generation_id.isnot(None))
            .group_by(Car.generation_id)
        ).all()
    }
    gens = (
        db.execute(
            select(CarGeneration)
            .where(CarGeneration.model_id == model_id)
            .order_by(CarGeneration.name)
        )
        .scalars()
        .all()
    )
    response.headers["Cache-Control"] = "no-store"
    return [
        CatalogTreeGenerationOut(
            id=g.id,
            name=g.name,
            slug=g.slug,
            listings_count=listing_per_generation.get(g.id, 0),
        )
        for g in gens
    ]


@app.post("/admin/car-brands", response_model=CarBrandBriefOut)
def admin_create_car_brand(
    payload: CarBrandCreateIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Укажите название марки")
    dup = db.execute(
        select(CarBrand).where(func.lower(CarBrand.name) == name.lower())
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(status_code=400, detail="Такая марка уже есть в справочнике")
    row = CarBrand(name=name)
    db.add(row)
    try:
        db.commit()
        db.refresh(row)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400, detail="Такая марка уже есть в справочнике"
        ) from None
    return row


@app.post("/admin/car-brands/{brand_id}/models", response_model=CarModelBriefOut)
def admin_create_car_model(
    brand_id: int,
    payload: CarModelCreateIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    if not db.get(CarBrand, brand_id):
        raise HTTPException(status_code=404, detail="Марка не найдена")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Укажите название модели")
    dup = db.execute(
        select(CarModel).where(
            CarModel.brand_id == brand_id,
            func.lower(CarModel.name) == name.lower(),
        )
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(
            status_code=400, detail="Такая модель уже есть у этой марки"
        )
    row = CarModel(brand_id=brand_id, name=name, is_active=True)
    db.add(row)
    try:
        db.commit()
        db.refresh(row)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400, detail="Такая модель уже есть у этой марки"
        ) from None
    return row


@app.post(
    "/admin/car-models/{model_id}/generations",
    response_model=CatalogTreeGenerationOut,
)
def admin_create_car_generation(
    model_id: int,
    payload: CarGenerationCreateIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    m = db.execute(select(CarModel).where(CarModel.id == model_id)).scalar_one_or_none()
    if not m:
        raise HTTPException(status_code=404, detail="Model not found")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    slug = _allocate_generation_slug(db, model_id, name)
    g = CarGeneration(model_id=model_id, name=name, slug=slug)
    db.add(g)
    db.commit()
    db.refresh(g)
    return CatalogTreeGenerationOut(
        id=g.id, name=g.name, slug=g.slug, listings_count=0
    )


@app.get("/staff/my-cars", response_model=list[CarOut])
def staff_my_posted_cars(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "moderator", "dealer")),
):
    cars = (
        db.execute(
            select(Car)
            .options(
                joinedload(Car.brand),
                joinedload(Car.model),
                joinedload(Car.generation),
                joinedload(Car.photos),
            )
            .where(
                Car.created_by_user_id == current_user.id,
                Car.is_active.is_(True),
            )
            .order_by(Car.id.desc())
        )
        .unique()
        .scalars()
        .all()
    )
    snap, _ = build_cbr_snapshot()
    slug_maps = _get_cached_slug_maps(db)
    return [
        _car_to_out(c, cbr=snap, full_import=False, slug_maps=slug_maps) for c in cars
    ]


@app.post("/staff/cars", response_model=CarOut)
async def staff_create_car(
    brand_id: int = Form(),
    model_id: int = Form(),
    generation_id: str | None = Form(None),
    title: str = Form(),
    description: str = Form(""),
    year: int = Form(),
    mileage_km: str | None = Form(None),
    engine_volume_cc: int = Form(),
    horsepower: int = Form(),
    fuel_type: str | None = Form(None),
    transmission: str | None = Form(None),
    location_city: str | None = Form(None),
    price_cny: float = Form(),
    registration_date: str | None = Form(None),
    production_date: str | None = Form(None),
    photos: list[UploadFile] | None = File(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "moderator", "dealer")),
):
    model_row = db.execute(
        select(CarModel).where(CarModel.id == model_id)
    ).scalar_one_or_none()
    if not model_row or model_row.brand_id != brand_id:
        raise HTTPException(
            status_code=400, detail="model_id does not match brand_id"
        )
    gid = _optional_generation_id_form(generation_id)
    _assert_generation_belongs_to_model(db, gid, model_id)

    upload_list = list(photos or [])
    if len(upload_list) > 15:
        raise HTTPException(status_code=400, detail="Too many photos (max 15)")
    blobs: list[bytes] = []
    for uf in upload_list:
        data = await uf.read()
        if len(data) > _MAX_STAFF_UPLOAD_BYTES:
            raise HTTPException(
                status_code=400, detail="Each photo must be at most 10 MB"
            )
        blobs.append(data)
    if not blobs:
        raise HTTPException(status_code=400, detail="Upload at least one photo")

    listing_id = f"manual-{uuid.uuid4().hex}"
    while (
        db.execute(select(Car).where(Car.source_listing_id == listing_id))
        .scalar_one_or_none()
    ):
        listing_id = f"manual-{uuid.uuid4().hex}"

    car = Car(
        source="manual",
        source_listing_id=listing_id,
        brand_id=brand_id,
        model_id=model_id,
        generation_id=gid,
        title=title.strip() or "Без названия",
        description=(description or "").strip(),
        year=year,
        mileage_km=_optional_mileage(mileage_km),
        engine_volume_cc=engine_volume_cc,
        horsepower=horsepower,
        fuel_type=(fuel_type or "").strip() or None,
        transmission=(transmission or "").strip() or None,
        location_city=(location_city or "").strip() or None,
        price_cny=float(price_cny),
        registration_date=(registration_date or "").strip() or None,
        production_date=(production_date or "").strip() or None,
        created_by_user_id=current_user.id,
    )
    db.add(car)
    db.commit()
    db.refresh(car)

    paths = save_uploaded_car_photos(car.id, blobs)
    if not paths:
        car_id_bad = car.id
        db.delete(car)
        db.commit()
        car_dir = MEDIA_ROOT / "cars" / str(car_id_bad)
        if car_dir.is_dir():
            try:
                shutil.rmtree(car_dir)
            except OSError:
                pass
        raise HTTPException(
            status_code=400,
            detail="No valid image files (use JPEG, PNG, WebP, or GIF)",
        )
    for i, url in enumerate(paths):
        db.add(CarPhoto(car_id=car.id, storage_url=url, sort_order=i))
    db.commit()

    car = (
        db.execute(
            select(Car)
            .options(
                joinedload(Car.brand),
                joinedload(Car.model),
                joinedload(Car.generation),
                joinedload(Car.photos),
            )
            .where(Car.id == car.id)
        )
        .unique()
        .scalar_one()
    )
    snap, _ = build_cbr_snapshot()
    slug_maps = _get_cached_slug_maps(db)
    return _car_to_out(car, cbr=snap, full_import=False, slug_maps=slug_maps)


@app.get("/staff/cars/{car_id}", response_model=CarOut)
def staff_get_own_car(
    car_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "moderator", "dealer")),
):
    """Карточка для редактирования: только если объявление создано этим пользователем и активно."""
    car = (
        db.execute(
            select(Car)
            .options(
                joinedload(Car.brand),
                joinedload(Car.model),
                joinedload(Car.generation),
                joinedload(Car.photos),
            )
            .where(
                Car.id == car_id,
                Car.created_by_user_id == current_user.id,
                Car.is_active.is_(True),
            )
        )
        .unique()
        .scalar_one_or_none()
    )
    if not car:
        raise HTTPException(status_code=404, detail="Car not found")
    snap, _ = build_cbr_snapshot()
    slug_maps = _get_cached_slug_maps(db)
    return _car_to_out(car, cbr=snap, full_import=bool(snap), slug_maps=slug_maps)


@app.put("/staff/cars/{car_id}", response_model=CarOut)
async def staff_update_own_car(
    car_id: int,
    brand_id: int = Form(),
    model_id: int = Form(),
    generation_id: str | None = Form(None),
    title: str = Form(),
    description: str = Form(""),
    year: int = Form(),
    mileage_km: str | None = Form(None),
    engine_volume_cc: int = Form(),
    horsepower: int = Form(),
    fuel_type: str | None = Form(None),
    transmission: str | None = Form(None),
    location_city: str | None = Form(None),
    price_cny: float = Form(),
    registration_date: str | None = Form(None),
    production_date: str | None = Form(None),
    photos: list[UploadFile] | None = File(None),
    remove_photo_ids: str | None = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "moderator", "dealer")),
):
    """
    Обновить объявление, созданное текущим пользователем (дилер / модератор / админ — только свои посты).
    Фото: как у PUT /admin/cars/{id}.
    """
    car = (
        db.execute(
            select(Car)
            .options(joinedload(Car.photos))
            .where(
                Car.id == car_id,
                Car.created_by_user_id == current_user.id,
                Car.is_active.is_(True),
            )
        )
        .unique()
        .scalar_one_or_none()
    )
    if not car:
        raise HTTPException(status_code=404, detail="Car not found")
    gid = _optional_generation_id_form(generation_id)
    return await _update_car_from_multipart(
        db,
        car,
        car_id,
        brand_id=brand_id,
        model_id=model_id,
        generation_id=gid,
        title=title,
        description=description,
        year=year,
        mileage_km=mileage_km,
        engine_volume_cc=engine_volume_cc,
        horsepower=horsepower,
        fuel_type=fuel_type,
        transmission=transmission,
        location_city=location_city,
        price_cny=price_cny,
        registration_date=registration_date,
        production_date=production_date,
        photos=photos,
        remove_photo_ids=remove_photo_ids,
    )


@app.delete("/staff/cars/{car_id}")
def staff_delete_own_car(
    car_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("dealer", "admin", "moderator")),
):
    """Снять с публикации только объявление, созданное этим пользователем (дилер / свои ручные посты)."""
    car = db.execute(select(Car).where(Car.id == car_id)).scalar_one_or_none()
    if not car:
        raise HTTPException(status_code=404, detail="Car not found")
    if car.created_by_user_id != current_user.id:
        raise HTTPException(
            status_code=403,
            detail="Можно снять только свои объявления",
        )
    if not car.is_active:
        return {"ok": True}
    car.is_active = False
    db.commit()
    car_dir = MEDIA_ROOT / "cars" / str(car_id)
    if car_dir.is_dir():
        try:
            shutil.rmtree(car_dir)
        except OSError:
            pass
    return {"ok": True}


# Register static /admin/cars/* routes before /admin/cars/{car_id} (avoids 405 on e.g. regenerate-listing-copy).
@app.post("/admin/cars/batch-rematch-models")
def admin_batch_rematch_models(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "moderator")),
    limit: int = Query(2000, ge=1, le=5000),
):
    """Пересчитать model_id у активных авто по title/description (без запросов к che168)."""
    stmt = (
        select(Car)
        .options(joinedload(Car.brand))
        .where(Car.is_active.is_(True))
        .order_by(Car.id.asc())
        .limit(limit)
    )
    cars = db.execute(stmt).unique().scalars().all()
    changed = 0
    for car in cars:
        if car.brand is None:
            continue
        new_id = resolve_model_id_for_listing(
            db,
            brand_name=car.brand.name,
            brand_id=car.brand_id,
            fallback_model_id=car.model_id,
            title=car.title,
            description=car.description,
            series_raw=None,
        )
        if new_id != car.model_id:
            car.model_id = new_id
            changed += 1
    db.commit()
    return {"ok": True, "scanned": len(cars), "model_id_changed": changed}


@app.post("/admin/cars/batch-refresh-from-che168")
def admin_batch_refresh_from_che168(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "moderator")),
    max_cars: int = Query(30, ge=1, le=80),
    offset: int = Query(0, ge=0),
):
    """
    Повторно скачать карточки с che168 и обновить модель, мощность, топливо, КПП, пробег и т.д.
    Ограничьте max_cars — запросы к сайту медленные и могут дать captcha.
    """
    stmt = (
        select(Car)
        .options(joinedload(Car.brand), joinedload(Car.model))
        .where(Car.is_active.is_(True), Car.source == "che168")
        .order_by(Car.id.asc())
        .offset(offset)
        .limit(max_cars)
    )
    cars = db.execute(stmt).unique().scalars().all()
    ok = 0
    errors: list[str] = []
    for car in cars:
        if car.brand is None:
            errors.append(f"id={car.id}: нет марки в БД")
            continue
        url = che168_detail_url_from_source_listing_id(car.source_listing_id)
        if not url:
            errors.append(f"id={car.id}: нет URL для source_listing_id")
            continue
        try:
            parsed = parse_che168_detail(url)
        except Exception as e:
            errors.append(f"id={car.id}: {e!s}")
            continue
        resolved = resolve_model_id_for_listing(
            db,
            brand_name=car.brand.name,
            brand_id=car.brand_id,
            fallback_model_id=car.model_id,
            title=parsed.title,
            description=parsed.description,
            series_raw=parsed.series_raw,
        )
        car.model_id = resolved
        resolved_row = db.get(CarModel, resolved)
        mn = resolved_row.name if resolved_row else (car.model.name if car.model else "Авто")

        if parsed.year is not None:
            car.year = parsed.year
        if parsed.engine_volume_cc is not None:
            car.engine_volume_cc = parsed.engine_volume_cc
        if parsed.horsepower is not None and parsed.horsepower > 0:
            car.horsepower = parsed.horsepower
        if parsed.mileage_km is not None:
            car.mileage_km = parsed.mileage_km
        if parsed.fuel_type:
            car.fuel_type = translate_to_ru(parsed.fuel_type) or parsed.fuel_type
        if parsed.transmission:
            car.transmission = translate_to_ru(parsed.transmission) or parsed.transmission
        if parsed.location_city:
            car.location_city = translate_to_ru(parsed.location_city) or parsed.location_city
        if parsed.price_cny is not None and parsed.price_cny > 0:
            car.price_cny = parsed.price_cny
        if parsed.registration_date:
            car.registration_date = parsed.registration_date
        if parsed.production_date:
            car.production_date = parsed.production_date

        title_tr = translate_to_ru(parsed.title) or parsed.title
        car.title = pick_title_ru(
            car.brand.name,
            mn,
            car.year,
            parsed.title,
            title_tr,
        )
        car.description = basic_neutral_description_ru(
            car.brand.name,
            mn,
            car.year,
            car.mileage_km,
            car.engine_volume_cc,
            car.horsepower,
            car.fuel_type,
            car.transmission,
            car.location_city,
        )
        ok += 1
        db.commit()

    return {
        "ok": True,
        "processed_ok": ok,
        "attempted": len(cars),
        "errors_sample": errors[:15],
        "errors_total": len(errors),
    }


@app.post("/admin/cars/regenerate-listing-copy")
def admin_regenerate_listing_copy(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "moderator")),
    limit: int = Query(2000, ge=1, le=10000),
):
    """
    Русский заголовок (марка · модель · год) и нейтральное описание по полям БД — без che168.
    """
    stmt = (
        select(Car)
        .options(joinedload(Car.brand), joinedload(Car.model))
        .where(Car.is_active.is_(True))
        .order_by(Car.id.asc())
        .limit(limit)
    )
    cars = db.execute(stmt).unique().scalars().all()
    updated = 0
    for car in cars:
        if car.brand is None or car.model is None:
            continue
        car.title = russian_listing_title(car.brand.name, car.model.name, car.year)
        car.description = basic_neutral_description_ru(
            car.brand.name,
            car.model.name,
            car.year,
            car.mileage_km,
            car.engine_volume_cc,
            car.horsepower,
            car.fuel_type,
            car.transmission,
            car.location_city,
        )
        updated += 1
    db.commit()
    return {"ok": True, "updated": updated}


@app.get("/admin/cars/{car_id}", response_model=CarOut)
def admin_get_car(
    car_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    """Карточка по id, в том числе снятая с публикации — для редактирования администратором."""
    car = (
        db.execute(
            select(Car)
            .options(
                joinedload(Car.brand),
                joinedload(Car.model),
                joinedload(Car.generation),
                joinedload(Car.photos),
            )
            .where(Car.id == car_id)
        )
        .unique()
        .scalar_one_or_none()
    )
    if not car:
        raise HTTPException(status_code=404, detail="Car not found")
    snap, _ = build_cbr_snapshot()
    slug_maps = _get_cached_slug_maps(db)
    return _car_to_out(car, cbr=snap, full_import=bool(snap), slug_maps=slug_maps)


@app.put("/admin/cars/{car_id}", response_model=CarOut)
async def admin_update_car(
    car_id: int,
    brand_id: int = Form(),
    model_id: int = Form(),
    generation_id: str | None = Form(None),
    title: str = Form(),
    description: str = Form(""),
    year: int = Form(),
    mileage_km: str | None = Form(None),
    engine_volume_cc: int = Form(),
    horsepower: int = Form(),
    fuel_type: str | None = Form(None),
    transmission: str | None = Form(None),
    location_city: str | None = Form(None),
    price_cny: float = Form(),
    registration_date: str | None = Form(None),
    production_date: str | None = Form(None),
    photos: list[UploadFile] | None = File(None),
    remove_photo_ids: str | None = Form(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    """
    Полное обновление полей объявления. Фото: если передать файлы — старые фото удаляются и заменяются;
    если не передавать — галерея не меняется.
    """
    car = (
        db.execute(
            select(Car)
            .options(joinedload(Car.photos))
            .where(Car.id == car_id)
        )
        .unique()
        .scalar_one_or_none()
    )
    if not car:
        raise HTTPException(status_code=404, detail="Car not found")
    gid = _optional_generation_id_form(generation_id)
    return await _update_car_from_multipart(
        db,
        car,
        car_id,
        brand_id=brand_id,
        model_id=model_id,
        generation_id=gid,
        title=title,
        description=description,
        year=year,
        mileage_km=mileage_km,
        engine_volume_cc=engine_volume_cc,
        horsepower=horsepower,
        fuel_type=fuel_type,
        transmission=transmission,
        location_city=location_city,
        price_cny=price_cny,
        registration_date=registration_date,
        production_date=production_date,
        photos=photos,
        remove_photo_ids=remove_photo_ids,
    )


@app.delete("/admin/cars/{car_id}")
def admin_delete_car(
    car_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "moderator")),
):
    car = db.execute(select(Car).where(Car.id == car_id)).scalar_one_or_none()
    if not car:
        raise HTTPException(status_code=404, detail="Car not found")
    car.is_active = False
    db.commit()
    car_dir = MEDIA_ROOT / "cars" / str(car_id)
    if car_dir.is_dir():
        try:
            shutil.rmtree(car_dir)
        except OSError:
            pass
    return {"ok": True}


@app.post("/admin/cars/{car_id}/rematch-model")
def admin_rematch_car_model(
    car_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "moderator")),
):
    """
    Пересчитать привязку к CarModel по текущим title/description (после улучшения резолвера).
    """
    car = (
        db.execute(
            select(Car).options(joinedload(Car.brand)).where(Car.id == car_id)
        )
        .unique()
        .scalar_one_or_none()
    )
    if not car:
        raise HTTPException(status_code=404, detail="Car not found")
    new_id = resolve_model_id_for_listing(
        db,
        brand_name=car.brand.name,
        brand_id=car.brand_id,
        fallback_model_id=car.model_id,
        title=car.title,
        description=car.description,
        series_raw=None,
    )
    old_id = car.model_id
    car.model_id = new_id
    db.commit()
    return {
        "ok": True,
        "car_id": car_id,
        "old_model_id": old_id,
        "new_model_id": new_id,
    }


def _user_to_admin_out(user: User) -> AdminUserOut:
    return AdminUserOut(
        id=user.id,
        email=user.email,
        phone=user.phone,
        full_name=user.full_name,
        display_name=user.display_name or "",
        company_name=user.company_name,
        role=user.role.code,
        is_active=user.is_active,
        email_verified=user.email_verified,
    )


@app.get("/admin/users", response_model=list[AdminUserOut])
def admin_list_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    users = (
        db.execute(select(User).options(joinedload(User.role)).order_by(User.id.asc()))
        .unique()
        .scalars()
        .all()
    )
    return [_user_to_admin_out(u) for u in users]


@app.post("/admin/users", response_model=AdminUserCreateResultOut)
def admin_create_user(
    payload: AdminUserCreateIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Некорректный email")
    exists = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=400, detail="Email уже занят")
    role = db.execute(select(Role).where(Role.code == payload.role)).scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=400, detail="Неизвестная роль")
    gen_pwd: str | None = None
    if payload.password and payload.password.strip():
        pwd = payload.password.strip()
        if len(pwd) < 8:
            raise HTTPException(status_code=400, detail="Пароль не короче 8 символов")
        must_change = False
    else:
        pwd = secrets.token_urlsafe(14)
        gen_pwd = pwd
        must_change = True
    user = User(
        email=email,
        phone=(payload.phone or "").strip() or None,
        full_name=(payload.full_name or "").strip(),
        password_hash=hash_password(pwd),
        role_id=role.id,
        is_active=True,
        email_verified=True,
        must_change_password=must_change,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    user = (
        db.execute(select(User).options(joinedload(User.role)).where(User.id == user.id))
        .unique()
        .scalar_one()
    )
    return AdminUserCreateResultOut(user=_user_to_admin_out(user), generated_password=gen_pwd)


@app.patch("/admin/users/{user_id}", response_model=AdminUserOut)
def admin_update_user(
    user_id: int,
    payload: AdminUserUpdateIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    user = (
        db.execute(select(User).options(joinedload(User.role)).where(User.id == user_id))
        .unique()
        .scalar_one_or_none()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.email is not None:
        em = payload.email.strip().lower()
        if not em or "@" not in em:
            raise HTTPException(status_code=400, detail="Некорректный email")
        dup = db.execute(
            select(User).where(User.email == em, User.id != user_id)
        ).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=400, detail="Email уже занят")
        user.email = em
    if payload.phone is not None:
        user.phone = payload.phone.strip() or None
    if payload.full_name is not None:
        user.full_name = payload.full_name.strip()
    if payload.display_name is not None:
        user.display_name = payload.display_name.strip()
    if payload.company_name is not None:
        user.company_name = payload.company_name.strip() or None
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.role is not None:
        role = db.execute(select(Role).where(Role.code == payload.role)).scalar_one_or_none()
        if not role:
            raise HTTPException(status_code=400, detail="Неизвестная роль")
        user.role_id = role.id
    db.commit()
    db.refresh(user)
    user = (
        db.execute(select(User).options(joinedload(User.role)).where(User.id == user_id))
        .unique()
        .scalar_one()
    )
    return _user_to_admin_out(user)


@app.post("/admin/users/{user_id}/reset-password", response_model=AdminPasswordResetOut)
def admin_reset_user_password(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    user = db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    new_pwd = secrets.token_urlsafe(14)
    user.password_hash = hash_password(new_pwd)
    user.must_change_password = True
    db.commit()
    return AdminPasswordResetOut(new_password=new_pwd)


@app.get("/admin/customs-calculator/config", response_model=CustomsCalcConfigOut)
def admin_get_customs_calculator_config(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    row = ensure_settings_row(db)
    return CustomsCalcConfigOut(
        config_yaml=row.config_yaml,
        util_coefficients_individual=row.util_coefficients_individual,
        util_coefficients_company=row.util_coefficients_company,
        additional_expenses_json=(
            row.additional_expenses_json or default_additional_expenses_json()
        ),
        updated_at=row.updated_at,
    )


@app.get("/admin/customs-calculator/util-defaults", response_model=UtilCoeffDefaultsOut)
def admin_customs_util_defaults(_: User = Depends(require_roles("admin"))):
    """Встроенные JSON-таблицы коэффициентов УС (сброс в админке)."""
    return UtilCoeffDefaultsOut(
        individual=build_default_util_json_individual(),
        company=build_default_util_json_company(),
    )


@app.put("/admin/customs-calculator/config", response_model=CustomsCalcConfigOut)
def admin_update_customs_calculator_config(
    payload: CustomsCalcConfigIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    _, err = validate_config_yaml(payload.config_yaml)
    if err:
        raise HTTPException(status_code=400, detail=err)
    j1 = validate_util_individual_json(payload.util_coefficients_individual)
    if j1:
        raise HTTPException(status_code=400, detail=j1)
    j2 = validate_util_company_json(payload.util_coefficients_company)
    if j2:
        raise HTTPException(status_code=400, detail=j2)
    j3 = validate_additional_expenses_json(payload.additional_expenses_json)
    if j3:
        raise HTTPException(status_code=400, detail=j3)
    row = ensure_settings_row(db)
    # Храним YAML как текст: не пересобираем через yaml.dump, чтобы не терять комментарии #.
    row.config_yaml = payload.config_yaml.strip() + "\n"

    def _norm(s: str | None) -> str | None:
        if s is None:
            return None
        t = s.strip()
        return t if t else None

    row.util_coefficients_individual = _norm(payload.util_coefficients_individual)
    row.util_coefficients_company = _norm(payload.util_coefficients_company)
    row.additional_expenses_json = _norm(payload.additional_expenses_json)
    db.commit()
    db.refresh(row)
    return CustomsCalcConfigOut(
        config_yaml=row.config_yaml,
        util_coefficients_individual=row.util_coefficients_individual,
        util_coefficients_company=row.util_coefficients_company,
        additional_expenses_json=(
            row.additional_expenses_json or default_additional_expenses_json()
        ),
        updated_at=row.updated_at,
    )


@app.post("/requests/lead", response_model=PublicRequestLeadOut)
def create_request_lead(payload: PublicRequestLeadIn, db: Session = Depends(get_db)):
    """
    Заявка на расчёт без авторизации: сохраняем контакты, создаём неподтверждённого пользователя
    (если нужно), отправляем код на email. После /auth/register/verify клиент получает временный пароль
    (новый пользователь) или access_token (уже существующий подтверждённый email).
    """
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Укажите корректный email")
    phone = (payload.phone or "").strip()
    full_name = (payload.full_name or "").strip()
    comment = (payload.comment or "").strip()

    car_exists = db.execute(
        select(Car).where(Car.id == payload.car_id, Car.is_active.is_(True))
    ).scalar_one_or_none()
    if not car_exists:
        raise HTTPException(status_code=404, detail="Car not found")

    existing = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if existing and existing.email_verified:
        code = f"{secrets.randbelow(900000) + 100000}"
        expires = datetime.now(timezone.utc) + timedelta(minutes=15)
        if phone:
            existing.phone = phone
        if full_name:
            existing.full_name = full_name
        existing.verification_code = code
        existing.verification_expires_at = expires
        db.commit()
        send_email(
            email,
            "Код для заявки на расчёт — avtovozom",
            "Вы оставили заявку на расчёт на сайте avtovozom с этого email (аккаунт уже есть).\n\n"
            f"Код подтверждения: {code}\n"
            "Срок действия: 15 минут.\n\n"
            "Введите код в форму на сайте, чтобы подтвердить заявку и войти в личный кабинет.\n"
            "Вход по коду — без ввода пароля.",
        )
        db.refresh(existing)
        user = existing
    else:
        user = _upsert_unverified_user_send_code(
            db,
            email=email,
            phone=phone,
            full_name=full_name,
            email_subject="Подтвердите email — заявка на расчёт (avtovozom)",
            email_body=(
                "Вы оставили заявку на расчёт на сайте avtovozom.\n\n"
                "Код подтверждения: {code}\n"
                "Срок действия: 15 минут.\n\n"
                "После подтверждения на этот адрес придёт временный пароль для входа в личный кабинет."
            ),
            verified_exists_detail=(
                "Этот email уже зарегистрирован. Войдите в аккаунт и отправьте заявку со страницы автомобиля."
            ),
        )

    user_name = full_name or email.split("@", 1)[0]
    user_contact = phone or email
    req = CalculationRequest(
        user_name=user_name,
        user_contact=user_contact,
        user_id=user.id,
        car_id=payload.car_id,
        comment=comment
        or "Заявка на расчёт под ключ до РФ (форма без входа).",
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    notify_new_calculation_request(
        request_id=req.id,
        car_id=req.car_id,
        user_name=user_name,
        user_contact=user_contact,
        comment=req.comment or "",
        car_page_url=_public_car_page_url(db, req.car_id),
    )
    return PublicRequestLeadOut(
        ok=True,
        request_id=req.id,
        message=(
            "Заявка принята. На email отправлен код — введите его ниже. "
            "Для нового аккаунта после кода придёт временный пароль; "
            "если этот email уже зарегистрирован, после кода откроется вход в кабинет."
        ),
    )


@app.post("/requests", response_model=CalculationRequestOut)
def create_request(
    payload: CreateRequestIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    car_exists = db.execute(
        select(Car).where(Car.id == payload.car_id, Car.is_active.is_(True))
    ).scalar_one_or_none()
    if not car_exists:
        raise HTTPException(status_code=404, detail="Car not found")

    request = CalculationRequest(
        user_name=payload.user_name or current_user.full_name or current_user.email,
        user_contact=payload.user_contact or current_user.email,
        user_id=current_user.id,
        car_id=payload.car_id,
        comment=payload.comment,
    )
    db.add(request)
    db.commit()
    db.refresh(request)
    notify_new_calculation_request(
        request_id=request.id,
        car_id=request.car_id,
        user_name=request.user_name,
        user_contact=request.user_contact,
        comment=request.comment or "",
        car_page_url=_public_car_page_url(db, request.car_id),
    )
    return request


def _unread_offers_count(request: CalculationRequest, offers: list[DealerOffer]) -> int:
    seen = request.offers_seen_at
    return sum(1 for o in offers if seen is None or o.created_at > seen)


def _calculation_requests_to_my_out(
    db: Session, requests: list[CalculationRequest]
) -> list[CalculationRequestMyOut]:
    if not requests:
        return []

    car_ids = [r.car_id for r in requests]
    cars = (
        db.execute(
            select(Car)
            .where(Car.id.in_(car_ids))
            .options(
                joinedload(Car.brand),
                joinedload(Car.model),
                joinedload(Car.photos),
            )
        )
        .unique()
        .scalars()
        .all()
    )
    car_map = {c.id: c for c in cars}

    req_ids = [r.id for r in requests]
    all_offers = (
        db.execute(
            select(DealerOffer)
            .where(DealerOffer.request_id.in_(req_ids))
            .order_by(DealerOffer.id.desc())
        )
        .scalars()
        .all()
    )
    offers_by_req: dict[int, list[DealerOffer]] = defaultdict(list)
    for o in all_offers:
        offers_by_req[o.request_id].append(o)

    all_chats = (
        db.execute(select(Chat).where(Chat.request_id.in_(req_ids)))
        .scalars()
        .all()
    )
    chat_by_pair: dict[tuple[int, int], int] = {
        (c.request_id, c.dealer_user_id): c.id for c in all_chats
    }

    out: list[CalculationRequestMyOut] = []
    for r in requests:
        car = car_map.get(r.car_id)
        if car and car.brand is not None and car.model is not None:
            car_title = car.title
            car_brand = car.brand.name
            car_model = car.model.name
            car_year = car.year
            photos = sorted(car.photos or [], key=lambda p: p.sort_order)
            car_thumb = photos[0].storage_url if photos else None
        else:
            car_title = "Объявление недоступно"
            car_brand = "—"
            car_model = "—"
            car_year = None
            car_thumb = None

        offs = offers_by_req[r.id]
        offer_outs = [
            DealerOfferOut.model_validate(x).model_copy(
                update={"chat_id": chat_by_pair.get((r.id, x.dealer_user_id))}
            )
            for x in offs
        ]
        out.append(
            CalculationRequestMyOut(
                id=r.id,
                user_name=r.user_name,
                user_contact=r.user_contact,
                car_id=r.car_id,
                comment=r.comment,
                status=r.status,
                created_at=r.created_at,
                car_title=car_title,
                car_brand=car_brand,
                car_model=car_model,
                car_year=car_year,
                car_thumb_url=car_thumb,
                offers=offer_outs,
                unread_offers_count=_unread_offers_count(r, offs),
            )
        )
    return out


@app.get("/requests/my", response_model=list[CalculationRequestMyOut])
def my_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    requests = (
        db.execute(
            select(CalculationRequest)
            .where(CalculationRequest.user_id == current_user.id)
            .order_by(CalculationRequest.id.desc())
        )
        .scalars()
        .all()
    )
    return _calculation_requests_to_my_out(db, requests)


@app.post("/requests/{request_id}/mark-offers-seen")
def mark_request_offers_seen(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    req = db.execute(
        select(CalculationRequest).where(CalculationRequest.id == request_id)
    ).scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    req.offers_seen_at = datetime.utcnow()
    db.commit()
    return {"ok": True}


def _public_web_origin() -> str:
    return (os.getenv("PUBLIC_WEB_ORIGIN") or "http://localhost:3000").rstrip("/")


def _public_car_page_url(db: Session, car_id: int) -> str:
    origin = _public_web_origin()
    car = (
        db.execute(
            select(Car)
            .options(joinedload(Car.brand), joinedload(Car.model))
            .where(Car.id == car_id)
        )
        .unique()
        .scalar_one_or_none()
    )
    if not car or car.brand is None or car.model is None:
        return f"{origin}/cars/{car_id}"
    slug_maps = _get_cached_slug_maps(db)
    bs, ms = slugs_for_car(car, slug_maps[0], slug_maps[1])
    return f"{origin}/catalog/{bs}/{ms}/{car_id}"


@app.get("/admin/calculation-requests", response_model=list[AdminCalculationRequestOut])
def admin_list_calculation_requests(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "moderator")),
):
    requests = (
        db.execute(
            select(CalculationRequest).order_by(CalculationRequest.id.desc()).limit(500)
        )
        .scalars()
        .all()
    )
    my_list = _calculation_requests_to_my_out(db, requests)
    user_ids = [r.user_id for r in requests if r.user_id]
    users_map: dict[int, User] = {}
    if user_ids:
        users = db.execute(select(User).where(User.id.in_(user_ids))).scalars().all()
        users_map = {u.id: u for u in users}
    out: list[AdminCalculationRequestOut] = []
    for r_db, base in zip(requests, my_list):
        u = users_map.get(r_db.user_id) if r_db.user_id else None
        out.append(
            AdminCalculationRequestOut(
                **base.model_dump(),
                client_email=u.email if u else None,
                client_user_id=r_db.user_id,
                car_page_url=_public_car_page_url(db, r_db.car_id),
            )
        )
    return out


@app.get("/admin/calculation-requests/{request_id}", response_model=AdminCalculationRequestOut)
def admin_get_calculation_request(
    request_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "moderator")),
):
    r = db.execute(
        select(CalculationRequest).where(CalculationRequest.id == request_id)
    ).scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=404, detail="Request not found")
    built = _calculation_requests_to_my_out(db, [r])
    if not built:
        raise HTTPException(status_code=404, detail="Request not found")
    base = built[0]
    u = None
    if r.user_id:
        u = db.execute(select(User).where(User.id == r.user_id)).scalar_one_or_none()
    return AdminCalculationRequestOut(
        **base.model_dump(),
        client_email=u.email if u else None,
        client_user_id=r.user_id,
        car_page_url=_public_car_page_url(db, r.car_id),
    )


def _format_offer_seed_message(
    db: Session, request: CalculationRequest, offer: DealerOffer
) -> str:
    price = offer.total_price
    try:
        price_s = f"{float(price):,.0f}".replace(",", " ")
    except (TypeError, ValueError):
        price_s = str(price)
    car_url = _public_car_page_url(db, request.car_id)
    lines = [
        f"Предварительный расчёт по заявке №{request.id}",
        "",
        f"Карточка авто: {car_url}",
        "",
        f"Итого: {price_s} {offer.currency}",
        f"Ориентировочный срок: {offer.eta_days} дн.",
    ]
    body = (offer.terms_text or "").strip()
    if body:
        lines.extend(["", body])
    return "\n".join(lines)


def _ensure_chat_with_seed(db: Session, request: CalculationRequest, offer: DealerOffer) -> Chat:
    existing = db.execute(
        select(Chat).where(
            Chat.request_id == request.id,
            Chat.dealer_user_id == offer.dealer_user_id,
        )
    ).scalar_one_or_none()
    if existing:
        return existing
    if request.user_id is None:
        raise HTTPException(status_code=400, detail="Request has no owner user_id")
    chat = Chat(
        request_id=request.id,
        user_id=request.user_id,
        dealer_user_id=offer.dealer_user_id,
        status="open",
    )
    db.add(chat)
    db.flush()
    seed = _format_offer_seed_message(db, request, offer)
    msg = ChatMessage(
        chat_id=chat.id,
        sender_user_id=offer.dealer_user_id,
        message_type="text",
        text=seed,
    )
    db.add(msg)
    db.flush()
    chat.last_message_at = msg.created_at
    return chat


@app.get("/dealer/requests", response_model=list[CalculationRequestDealerOut])
def dealer_open_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("dealer", "admin", "moderator")),
):
    requests = (
        db.execute(
            select(CalculationRequest)
            .where(CalculationRequest.status == "open")
            .order_by(CalculationRequest.id.desc())
            .limit(100)
        )
        .scalars()
        .all()
    )
    if not requests:
        return []

    car_ids = [r.car_id for r in requests]
    cars = (
        db.execute(
            select(Car)
            .where(Car.id.in_(car_ids))
            .options(
                joinedload(Car.brand),
                joinedload(Car.model),
                joinedload(Car.photos),
            )
        )
        .unique()
        .scalars()
        .all()
    )
    car_map = {c.id: c for c in cars}

    req_ids = [r.id for r in requests]
    dealer_id = current_user.id
    my_offers = (
        db.execute(
            select(DealerOffer).where(
                DealerOffer.request_id.in_(req_ids),
                DealerOffer.dealer_user_id == dealer_id,
            )
        )
        .scalars()
        .all()
    )
    my_offer_by_req = {o.request_id: o for o in my_offers}

    my_chats = (
        db.execute(
            select(Chat).where(
                Chat.request_id.in_(req_ids),
                Chat.dealer_user_id == dealer_id,
            )
        )
        .scalars()
        .all()
    )
    chat_by_req = {c.request_id: c for c in my_chats}

    out: list[CalculationRequestDealerOut] = []
    for r in requests:
        car = car_map.get(r.car_id)
        if car and car.brand is not None and car.model is not None:
            car_title = car.title
            car_brand = car.brand.name
            car_model = car.model.name
            car_year = car.year
            photos = sorted(car.photos or [], key=lambda p: p.sort_order)
            car_thumb = photos[0].storage_url if photos else None
        else:
            car_title = "Объявление недоступно"
            car_brand = "—"
            car_model = "—"
            car_year = None
            car_thumb = None

        mo = my_offer_by_req.get(r.id)
        ch = chat_by_req.get(r.id)
        mo_out = None
        if mo:
            mo_out = DealerOfferOut.model_validate(mo).model_copy(
                update={"chat_id": ch.id if ch else None}
            )

        out.append(
            CalculationRequestDealerOut(
                id=r.id,
                user_name=r.user_name,
                user_contact=r.user_contact,
                car_id=r.car_id,
                comment=r.comment,
                status=r.status,
                created_at=r.created_at,
                car_title=car_title,
                car_brand=car_brand,
                car_model=car_model,
                car_year=car_year,
                car_thumb_url=car_thumb,
                my_offer=mo_out,
                chat_id=ch.id if ch else None,
                client_has_account=r.user_id is not None,
            )
        )
    return out


@app.post("/requests/{request_id}/offers", response_model=DealerOfferOut)
def create_dealer_offer(
    request_id: int,
    payload: DealerOfferCreateIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("dealer")),
):
    request = db.execute(
        select(CalculationRequest).where(CalculationRequest.id == request_id)
    ).scalar_one_or_none()
    if not request:
        raise HTTPException(status_code=404, detail="Request not found")
    if request.status != "open":
        raise HTTPException(status_code=400, detail="Request is not open")
    if payload.total_price <= 0:
        raise HTTPException(status_code=400, detail="Укажите положительную сумму.")
    if not (payload.terms_text or "").strip():
        raise HTTPException(
            status_code=400,
            detail="Заполните поле с расчётом и уточняющими вопросами для клиента.",
        )

    existing = db.execute(
        select(DealerOffer).where(
            DealerOffer.request_id == request_id,
            DealerOffer.dealer_user_id == current_user.id,
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=400,
            detail="Вы уже отправляли расчёт по этой заявке.",
        )

    offer = DealerOffer(
        request_id=request_id,
        dealer_user_id=current_user.id,
        total_price=payload.total_price,
        currency=payload.currency,
        eta_days=payload.eta_days,
        terms_text=payload.terms_text,
        status="sent",
    )
    db.add(offer)
    db.commit()
    db.refresh(offer)
    return DealerOfferOut.model_validate(offer).model_copy(update={"chat_id": None})


@app.get("/requests/{request_id}/offers", response_model=list[DealerOfferOut])
def list_offers_for_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    request = db.execute(
        select(CalculationRequest).where(CalculationRequest.id == request_id)
    ).scalar_one_or_none()
    if not request:
        raise HTTPException(status_code=404, detail="Request not found")

    is_owner = request.user_id == current_user.id
    is_staff = current_user.role.code in ("admin", "moderator")
    is_dealer = current_user.role.code == "dealer"
    if not (is_owner or is_staff or is_dealer):
        raise HTTPException(status_code=403, detail="Forbidden")

    offers = (
        db.execute(
            select(DealerOffer)
            .where(DealerOffer.request_id == request_id)
            .order_by(DealerOffer.id.desc())
        )
        .scalars()
        .all()
    )
    chats = (
        db.execute(select(Chat).where(Chat.request_id == request_id))
        .scalars()
        .all()
    )
    chat_by_dealer = {c.dealer_user_id: c.id for c in chats}
    return [
        DealerOfferOut.model_validate(o).model_copy(update={"chat_id": chat_by_dealer.get(o.dealer_user_id)})
        for o in offers
    ]


@app.post("/offers/{offer_id}/open-chat", response_model=OpenChatOut)
def open_offer_chat(
    offer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    offer = db.execute(select(DealerOffer).where(DealerOffer.id == offer_id)).scalar_one_or_none()
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found")
    request = db.execute(
        select(CalculationRequest).where(CalculationRequest.id == offer.request_id)
    ).scalar_one_or_none()
    if not request:
        raise HTTPException(status_code=404, detail="Request not found")
    if request.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if request.user_id is None:
        raise HTTPException(
            status_code=400,
            detail="Чат недоступен: заявка без привязки к аккаунту.",
        )
    chat = _ensure_chat_with_seed(db, request, offer)
    db.commit()
    return OpenChatOut(chat_id=chat.id)


@app.post("/offers/{offer_id}/select", response_model=DealerOfferOut)
def select_offer(
    offer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    offer = db.execute(select(DealerOffer).where(DealerOffer.id == offer_id)).scalar_one_or_none()
    if not offer:
        raise HTTPException(status_code=404, detail="Offer not found")

    request = db.execute(
        select(CalculationRequest).where(CalculationRequest.id == offer.request_id)
    ).scalar_one()
    if request.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only request owner can select offer")

    all_offers = (
        db.execute(select(DealerOffer).where(DealerOffer.request_id == request.id))
        .scalars()
        .all()
    )
    for row in all_offers:
        row.status = "selected" if row.id == offer.id else "rejected"
    request.status = "in_progress"

    if request.user_id is None:
        raise HTTPException(status_code=400, detail="Request has no owner user_id")

    chat = _ensure_chat_with_seed(db, request, offer)
    db.commit()
    db.refresh(offer)
    return DealerOfferOut.model_validate(offer).model_copy(update={"chat_id": chat.id})


def _user_peer_chat_label(user: User | None) -> str:
    if not user:
        return "Участник"
    role_code = user.role.code if user.role else ""
    if role_code == "dealer":
        co = (user.company_name or "").strip()
        dn = (user.display_name or "").strip()
        fn = (user.full_name or "").strip()
        if co:
            tail = dn or fn
            return f"{co} · {tail}" if tail else co
        return dn or fn or user.email
    dn = (user.display_name or "").strip()
    fn = (user.full_name or "").strip()
    return dn or fn or user.email


def _chat_attachment_message_type(original_name: str) -> str:
    lower = (original_name or "").lower()
    for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic"):
        if lower.endswith(ext):
            return "image"
    return "file"


def _unread_for_chat(
    db: Session, chat_id: int, peer_sender_id: int, last_read_message_id: int | None
) -> int:
    lr = last_read_message_id or 0
    return int(
        db.execute(
            select(func.count())
            .select_from(ChatMessage)
            .where(
                ChatMessage.chat_id == chat_id,
                ChatMessage.sender_user_id == peer_sender_id,
                ChatMessage.id > lr,
            )
        ).scalar_one()
    )


def _build_chat_list_items(
    db: Session, chats: list[Chat], current_user: User, *, is_staff: bool
) -> list[ChatListItemOut]:
    if not chats:
        return []

    chat_ids = [c.id for c in chats]
    req_ids = list({c.request_id for c in chats})
    reqs = db.execute(select(CalculationRequest).where(CalculationRequest.id.in_(req_ids))).scalars().all()
    req_map = {r.id: r for r in reqs}

    car_ids = [r.car_id for r in reqs if r]
    car_map: dict[int, Car] = {}
    if car_ids:
        for car in (
            db.execute(
                select(Car)
                .where(Car.id.in_(car_ids))
                .options(joinedload(Car.brand), joinedload(Car.model))
            )
            .unique()
            .scalars()
            .all()
        ):
            car_map[car.id] = car

    msgs = (
        db.execute(
            select(ChatMessage)
            .where(ChatMessage.chat_id.in_(chat_ids))
            .order_by(ChatMessage.chat_id.asc(), ChatMessage.id.desc())
        )
        .scalars()
        .all()
    )
    last_by_chat: dict[int, ChatMessage] = {}
    for m in msgs:
        if m.chat_id not in last_by_chat:
            last_by_chat[m.chat_id] = m

    user_ids: set[int] = set()
    for c in chats:
        user_ids.add(c.user_id)
        user_ids.add(c.dealer_user_id)
    user_map = {
        u.id: u
        for u in db.execute(
            select(User).where(User.id.in_(user_ids)).options(joinedload(User.role))
        )
        .unique()
        .scalars()
        .all()
    }

    chats_sorted = sorted(
        chats,
        key=lambda ch: (ch.last_message_at or ch.created_at, ch.id),
        reverse=True,
    )

    out: list[ChatListItemOut] = []
    for chat in chats_sorted:
        req = req_map.get(chat.request_id)
        car_title = "Заявка"
        if req and req.car_id in car_map:
            car = car_map[req.car_id]
            if car.brand is not None and car.model is not None:
                car_title = f"{car.brand.name} {car.model.name}"
        title = f"{car_title} · №{chat.request_id}"

        last_msg = last_by_chat.get(chat.id)
        preview: str | None = None
        if last_msg:
            chunks: list[str] = []
            if (last_msg.text or "").strip():
                t = last_msg.text.strip()
                chunks.append(t[:180] + ("…" if len(t) > 180 else ""))
            if getattr(last_msg, "attachment_url", None):
                label = last_msg.attachment_original_name or "вложение"
                chunks.append(f"📎 {label}")
            if chunks:
                preview = " ".join(chunks)[:220]

        if is_staff:
            uc = user_map.get(chat.user_id)
            ud = user_map.get(chat.dealer_user_id)
            peer_display = f"{_user_peer_chat_label(uc)} · {_user_peer_chat_label(ud)}"
            peer_role = "staff"
            unread = 0
        elif current_user.id == chat.user_id:
            peer = user_map.get(chat.dealer_user_id)
            peer_display = _user_peer_chat_label(peer) if peer else "Дилер"
            peer_role = "dealer"
            unread = _unread_for_chat(
                db, chat.id, chat.dealer_user_id, chat.user_last_read_message_id
            )
        else:
            peer = user_map.get(chat.user_id)
            peer_display = _user_peer_chat_label(peer) if peer else "Клиент"
            peer_role = "client"
            unread = _unread_for_chat(
                db, chat.id, chat.user_id, chat.dealer_last_read_message_id
            )

        out.append(
            ChatListItemOut(
                id=chat.id,
                request_id=chat.request_id,
                user_id=chat.user_id,
                dealer_user_id=chat.dealer_user_id,
                status=chat.status,
                created_at=chat.created_at,
                title=title,
                peer_role=peer_role,
                peer_display=peer_display,
                last_message_text=preview,
                last_message_at=last_msg.created_at if last_msg else None,
                unread_count=unread,
            )
        )
    return out


@app.get("/chats/my", response_model=list[ChatListItemOut])
def my_chats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    is_staff = current_user.role.code in ("admin", "moderator")
    q = select(Chat)
    if not is_staff:
        q = q.where((Chat.user_id == current_user.id) | (Chat.dealer_user_id == current_user.id))
    chats = list(db.execute(q).scalars().all())
    return _build_chat_list_items(db, chats, current_user, is_staff=is_staff)


@app.get("/chats/{chat_id}/messages", response_model=list[ChatMessageOut])
def chat_messages(
    chat_id: int,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    chat = db.execute(select(Chat).where(Chat.id == chat_id)).scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    is_staff = current_user.role.code in ("admin", "moderator")
    if not is_staff and not (
        chat.user_id == current_user.id or chat.dealer_user_id == current_user.id
    ):
        raise HTTPException(status_code=403, detail="Forbidden")

    messages = (
        db.execute(
            select(ChatMessage)
            .where(ChatMessage.chat_id == chat_id)
            .order_by(ChatMessage.id.desc())
            .offset(offset)
            .limit(limit)
        )
        .scalars()
        .all()
    )
    if not is_staff:
        latest_id = (
            db.execute(select(func.max(ChatMessage.id)).where(ChatMessage.chat_id == chat_id)).scalar_one_or_none()
        )
        if latest_id:
            if current_user.id == chat.user_id:
                prev = chat.user_last_read_message_id or 0
                if latest_id > prev:
                    chat.user_last_read_message_id = latest_id
            elif current_user.id == chat.dealer_user_id:
                prev = chat.dealer_last_read_message_id or 0
                if latest_id > prev:
                    chat.dealer_last_read_message_id = latest_id
            db.commit()

    # вернуть в хронологическом порядке
    return list(reversed(messages))


@app.post("/chats/{chat_id}/messages", response_model=ChatMessageOut)
async def send_chat_message(
    chat_id: int,
    text: str = Form(""),
    file: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    chat = db.execute(select(Chat).where(Chat.id == chat_id)).scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    is_staff = current_user.role.code in ("admin", "moderator")
    if not is_staff and not (
        chat.user_id == current_user.id or chat.dealer_user_id == current_user.id
    ):
        raise HTTPException(status_code=403, detail="Forbidden")

    text_clean = (text or "").strip()
    att_url: str | None = None
    att_name: str | None = None
    msg_type = "text"

    if file is not None and (file.filename or "").strip():
        raw = await file.read()
        if len(raw) > 15 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Файл слишком большой (максимум 15 МБ).")
        try:
            att_url, att_name = save_chat_attachment(chat_id, raw, file.filename or "file")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        msg_type = _chat_attachment_message_type(att_name or "")

    if not text_clean and not att_url:
        raise HTTPException(status_code=400, detail="Добавьте текст или вложение")

    msg = ChatMessage(
        chat_id=chat_id,
        sender_user_id=current_user.id,
        message_type=msg_type,
        text=text_clean or None,
        attachment_url=att_url,
        attachment_original_name=att_name,
    )
    db.add(msg)
    db.flush()
    db.refresh(msg)
    chat.last_message_at = msg.created_at
    if current_user.id == chat.user_id:
        chat.user_last_read_message_id = msg.id
    elif current_user.id == chat.dealer_user_id:
        chat.dealer_last_read_message_id = msg.id
    db.commit()
    db.refresh(msg)
    return msg


@app.get("/admin/model-whitelist")
def get_whitelist(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "moderator")),
):
    models = db.execute(
        select(CarModel, CarBrand, ModelWhitelist)
        .join(CarBrand, CarModel.brand_id == CarBrand.id)
        .outerjoin(ModelWhitelist, ModelWhitelist.model_id == CarModel.id)
        .order_by(CarBrand.name, CarModel.name)
    ).all()

    return [
        {
            "model_id": model.id,
            "brand": brand.name,
            "model": model.name,
            "enabled": whitelist.enabled if whitelist else False,
            "che168_url": model.che168_url,
        }
        for model, brand, whitelist in models
    ]


@app.put("/admin/car-models/{model_id}/catalog")
def update_car_model_catalog_url(
    model_id: int,
    payload: CarModelCatalogIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "moderator")),
):
    row = db.execute(select(CarModel).where(CarModel.id == model_id)).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Model not found")
    u = (payload.che168_url or "").strip()
    row.che168_url = u or None
    db.commit()
    db.refresh(row)
    return {"model_id": row.id, "che168_url": row.che168_url}


@app.put("/admin/model-whitelist")
def update_whitelist(
    items: list[ModelWhitelistItem],
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "moderator")),
):
    for item in items:
        row = db.execute(
            select(ModelWhitelist).where(ModelWhitelist.model_id == item.model_id)
        ).scalar_one_or_none()
        if row:
            row.enabled = item.enabled
        else:
            db.add(ModelWhitelist(model_id=item.model_id, enabled=item.enabled))
    db.commit()
    return {"status": "ok"}


def _run_parser_job_background(job_id: int) -> None:
    """Выполняет job после ответа HTTP, чтобы UI не ждал Playwright."""
    db = SessionLocal()
    try:
        job = db.execute(select(ParseJob).where(ParseJob.id == job_id)).scalar_one_or_none()
        if not job or job.status != "queued":
            return
        run_parser_job(db, job)
    except Exception as e:
        row = db.execute(select(ParseJob).where(ParseJob.id == job_id)).scalar_one_or_none()
        if row and row.status == "running" and row.finished_at is None:
            row.status = "failed"
            row.message = str(e)[:500]
            row.finished_at = datetime.utcnow()
            db.commit()
    finally:
        db.close()


@app.post("/admin/parser/run", response_model=ParseJobOut)
def run_parser_manually(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "moderator")),
):
    job = ParseJob(type="manual", status="queued")
    db.add(job)
    db.commit()
    db.refresh(job)
    background_tasks.add_task(_run_parser_job_background, job.id)
    return job


@app.post("/admin/parser/import-listing", response_model=ParseJobOut)
def import_che168_listing(
    payload: ParserImportListingIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "moderator")),
):
    """Сохраняет ссылку на модель, включает whitelist и ставит в очередь разбор одной карточки."""
    url = (payload.che168_url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="Укажите ссылку на объявление che168.")
    exists = db.execute(select(CarModel).where(CarModel.id == payload.model_id)).scalar_one_or_none()
    if not exists:
        raise HTTPException(status_code=404, detail="Модель не найдена.")
    job = ParseJob(
        type="import_one",
        status="queued",
        import_model_id=payload.model_id,
        import_detail_url=url[:2048],
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    background_tasks.add_task(_run_parser_job_background, job.id)
    return job


@app.get("/admin/parser/jobs", response_model=list[ParseJobOut])
def parser_jobs(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "moderator")),
):
    jobs = db.execute(select(ParseJob).order_by(ParseJob.id.desc()).limit(40)).scalars().all()
    return jobs


@app.get("/admin/parser/latest", response_model=ParseJobOut)
def parser_latest(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "moderator")),
):
    latest = db.execute(select(ParseJob).order_by(ParseJob.id.desc()).limit(1)).scalar_one_or_none()
    if not latest:
        raise HTTPException(status_code=404, detail="No parser jobs yet")
    return latest


@app.get("/admin/parser/jobs/{job_id}", response_model=ParseJobOut)
def parser_job_by_id(
    job_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "moderator")),
):
    job = db.execute(select(ParseJob).where(ParseJob.id == job_id)).scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
