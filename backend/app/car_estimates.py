"""Денормализованный estimated_total_rub на cars + быстрый ETC для списков."""

from __future__ import annotations

import zlib
from datetime import date, datetime, timedelta, timezone
from threading import Lock
from typing import Any
from zoneinfo import ZoneInfo

import yaml
from sqlalchemy import or_, select, text
from sqlalchemy.orm import Session

from .additional_expenses import parse_additional_expenses_json
from .car_pricing import build_cbr_snapshot, rub_china_for_car
from .cbr_rates import get_cbr_official_daily_rates
from .customs_calc import ensure_settings_row
from .customs_physical import compute_etc_individual
from .customs_util_json import ALLOWED_PP_KEYS_INDIVIDUAL, apply_util_json_to_pp
from .engine_volume_util import normalize_passenger_engine_volume_cc
from .models import Car, CustomsCalcSettings
from .schemas import CbrSnapshot

try:
    MSK = ZoneInfo("Europe/Moscow")
except Exception:
    MSK = timezone(timedelta(hours=3))

_ETC_RUBS_CACHE: dict[
    tuple[int, str, str, int, int, int], tuple[float, float, float]
] = {}
_ETC_RUBS_LOCK = Lock()
_ETC_RUBS_CACHE_MAX = 8000
_TARIFFS_CFG_CACHE: dict[int, dict[str, Any]] = {}
_TARIFFS_CFG_LOCK = Lock()

_estimates_ready_lock = Lock()
_estimates_ready_for_key: str | None = None


def estimate_freshness_key(snap: CbrSnapshot | None) -> str:
    """Ключ свежести оценки: дата + курс (курс ВТБ меняется внутри дня)."""
    if snap is None:
        return ""
    date_part = (snap.rate_date or "").strip()
    try:
        rate_part = f"{float(snap.rub_per_cny):.4f}"
    except (TypeError, ValueError):
        rate_part = ""
    if not date_part and not rate_part:
        return ""
    return f"{date_part}|{rate_part}"


def _parse_car_registration_date(s: str | None) -> date | None:
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
        try:
            y = int(t)
            if 1980 <= y <= 2100:
                return date(y, 1, 1)
        except ValueError:
            return None
    return None


def _subtract_years_safe(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year - years)
    except ValueError:
        return d.replace(month=2, day=28, year=d.year - years)


def car_age_group_for_calc(car: Car) -> str:
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


def car_engine_type_for_calc(car: Car) -> str:
    raw = (car.fuel_type or "").strip().lower()
    if any(token in raw for token in ("элект", "electric", "ev", "纯电", "bev")):
        return "electric"
    if "diesel" in raw or "диз" in raw:
        return "diesel"
    if any(token in raw for token in ("hybrid", "гиб", "phev", "hev", "增程")):
        return "hybrid"
    return "gasoline"


def to_rub(amount: float, currency: str, rub_per_cny: float) -> float:
    cur = (currency or "RUB").strip().upper()
    if cur == "CNY":
        return float(amount) * float(rub_per_cny)
    return float(amount)


def estimate_fingerprint(row: CustomsCalcSettings) -> int:
    h = zlib.crc32((row.config_yaml or "").encode("utf-8", errors="replace"))
    h = zlib.crc32(
        (row.util_coefficients_individual or "").encode("utf-8", errors="replace"), h
    )
    h = zlib.crc32(
        (row.util_coefficients_company or "").encode("utf-8", errors="replace"), h
    )
    return h & 0xFFFFFFFF


def tariffs_dict_for_settings(row: CustomsCalcSettings) -> dict[str, Any]:
    fp = estimate_fingerprint(row)
    with _TARIFFS_CFG_LOCK:
        hit = _TARIFFS_CFG_CACHE.get(fp)
        if hit is not None:
            return hit
    tariffs_cfg = yaml.safe_load(row.config_yaml or "") or {}
    tariffs = dict(tariffs_cfg.get("tariffs") or {})
    pp_cfg = dict(tariffs.get("physical_person") or {})
    if row.util_coefficients_individual and str(row.util_coefficients_individual).strip():
        apply_util_json_to_pp(
            pp_cfg,
            row.util_coefficients_individual,
            allowed=ALLOWED_PP_KEYS_INDIVIDUAL,
        )
    tariffs["physical_person"] = pp_cfg
    with _TARIFFS_CFG_LOCK:
        if len(_TARIFFS_CFG_CACHE) > 8:
            _TARIFFS_CFG_CACHE.clear()
        _TARIFFS_CFG_CACHE[fp] = tariffs
    return tariffs


def get_etc_customs_rubs(
    car: Car, row: CustomsCalcSettings
) -> tuple[float, float, float] | None:
    engine_type = car_engine_type_for_calc(car)
    age_group = car_age_group_for_calc(car)
    engine_capacity = normalize_passenger_engine_volume_cc(int(car.engine_volume_cc or 0))
    if engine_type != "electric":
        engine_capacity = max(50, engine_capacity)
    power = max(1, int(car.horsepower or 1))
    price_key = int(round(float(car.price_cny) * 100))
    fp = estimate_fingerprint(row)
    key = (fp, age_group, engine_type, engine_capacity, power, price_key)
    with _ETC_RUBS_LOCK:
        hit = _ETC_RUBS_CACHE.get(key)
    if hit is not None:
        return hit
    try:
        daily, derr = get_cbr_official_daily_rates()
        if derr or not daily:
            return None
        tariffs = tariffs_dict_for_settings(row)
        etc, _meta = compute_etc_individual(
            age=age_group,
            engine_type=engine_type,
            engine_capacity=engine_capacity,
            power=power,
            price=float(car.price_cny),
            currency="CNY",
            daily=daily,
            tariffs=tariffs,
        )
        hit = (
            float(etc.get("Clearance Fee (RUB)") or 0),
            float(etc.get("Duty (RUB)") or 0),
            float(etc.get("Utilization Fee (RUB)") or 0),
        )
    except Exception:
        return None
    with _ETC_RUBS_LOCK:
        if len(_ETC_RUBS_CACHE) >= _ETC_RUBS_CACHE_MAX:
            _ETC_RUBS_CACHE.clear()
        _ETC_RUBS_CACHE[key] = hit
    return hit


def invalidate_etc_estimate_caches() -> None:
    global _estimates_ready_for_cbr_date
    with _ETC_RUBS_LOCK:
        _ETC_RUBS_CACHE.clear()
    with _TARIFFS_CFG_LOCK:
        _TARIFFS_CFG_CACHE.clear()
    with _estimates_ready_lock:
        _estimates_ready_for_cbr_date = None


def compute_estimated_total_rub(
    car: Car,
    row: CustomsCalcSettings,
    cbr: CbrSnapshot,
    *,
    extras: dict[str, Any] | None = None,
) -> float | None:
    rubs = get_etc_customs_rubs(car, row)
    if rubs is None:
        return None
    clearance, duty, util = rubs
    rub_china = float(rub_china_for_car(car, cbr))
    if extras is None:
        extras = parse_additional_expenses_json(row.additional_expenses_json)
    export_raw = extras["export_expenses"]
    russia_raw = extras["russia_expenses"]
    bank_raw = extras["bank_commission"]
    company_raw = extras["company_commission"]
    export_rub = to_rub(float(export_raw["amount"]), str(export_raw["currency"]), cbr.rub_per_cny)
    russia_rub = to_rub(float(russia_raw["amount"]), str(russia_raw["currency"]), cbr.rub_per_cny)
    company_rub = to_rub(float(company_raw["amount"]), str(company_raw["currency"]), cbr.rub_per_cny)
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


def stored_estimate_is_fresh(car: Car, freshness_key: str | None) -> bool:
    if car.estimated_total_rub is None:
        return False
    return (car.estimate_cbr_date or "") == (freshness_key or "")


def stored_estimate_if_fresh(car: Car, freshness_key: str | None) -> float | None:
    if stored_estimate_is_fresh(car, freshness_key):
        try:
            return float(car.estimated_total_rub)
        except (TypeError, ValueError):
            return None
    return None


def write_car_estimate(car: Car, est: float | None, freshness_key: str | None) -> None:
    car.estimated_total_rub = est
    car.estimate_cbr_date = (freshness_key or "") or None


def refresh_car_stored_estimate(
    db: Session,
    car: Car,
    *,
    snap: CbrSnapshot | None = None,
    settings_row: CustomsCalcSettings | None = None,
    extras: dict[str, Any] | None = None,
    commit: bool = False,
) -> float | None:
    if snap is None:
        snap, _err = build_cbr_snapshot()
    if snap is None:
        return None
    if settings_row is None:
        settings_row = ensure_settings_row(db)
    if extras is None:
        extras = parse_additional_expenses_json(settings_row.additional_expenses_json)
    est = compute_estimated_total_rub(car, settings_row, snap, extras=extras)
    write_car_estimate(car, est, estimate_freshness_key(snap))
    if commit:
        db.commit()
    return est


def clear_stored_estimates(db: Session) -> None:
    """Сброс денормализованных оценок (после смены тарифов в админке)."""
    global _estimates_ready_for_key
    db.execute(
        text(
            "UPDATE cars SET estimated_total_rub = NULL, estimate_cbr_date = NULL "
            "WHERE estimated_total_rub IS NOT NULL OR estimate_cbr_date IS NOT NULL"
        )
    )
    db.commit()
    with _estimates_ready_lock:
        _estimates_ready_for_key = None
    invalidate_etc_estimate_caches()


def ensure_active_estimates_fresh(
    db: Session,
    *,
    snap: CbrSnapshot,
    settings_row: CustomsCalcSettings,
    extras: dict[str, Any] | None = None,
) -> None:
    """Досчитать/обновить estimated_total_rub у активных лотов под текущий курс."""
    global _estimates_ready_for_key
    freshness_key = estimate_freshness_key(snap)
    if extras is None:
        extras = parse_additional_expenses_json(settings_row.additional_expenses_json)
    with _estimates_ready_lock:
        if _estimates_ready_for_key == freshness_key:
            return
        stale = (
            db.execute(
                select(Car).where(
                    Car.is_active.is_(True),
                    or_(
                        Car.estimated_total_rub.is_(None),
                        Car.estimate_cbr_date.is_(None),
                        Car.estimate_cbr_date != freshness_key,
                    ),
                )
            )
            .scalars()
            .all()
        )
        for i, car in enumerate(stale):
            try:
                est = compute_estimated_total_rub(
                    car, settings_row, snap, extras=extras
                )
            except Exception:
                est = None
            write_car_estimate(car, est, freshness_key)
            if (i + 1) % 100 == 0:
                db.commit()
        db.commit()
        _estimates_ready_for_key = freshness_key
