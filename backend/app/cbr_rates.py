"""Курсы валют ЦБ РФ: официальные (таможня) и fallback для витрины без наценки."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date
from threading import Lock

import httpx

CBR_DAILY_URL = "https://www.cbr.ru/scripts/XML_daily.asp"

_lock = Lock()
_cache_day: str | None = None
_cache_official: dict[str, float] | None = None
_cache_meta_date: str | None = None


@dataclass(frozen=True)
class CbrCnyRate:
    rub_per_one_cny: float
    """Сколько рублей за 1 китайский юань (витринный курс продажи)."""

    rate_date: str
    """Дата курса (ВТБ или XML ЦБ, часто dd.mm.yyyy)."""


@dataclass(frozen=True)
class CbrDailyRates:
    """Сколько рублей за 1 единицу иностранной валюты."""

    rub_per_unit: dict[str, float]
    rate_date: str


def _parse_cbr_xml(content: bytes) -> tuple[dict[str, float], str]:
    root = ET.fromstring(content)
    meta = (root.attrib.get("Date") or "").strip() or date.today().isoformat()
    official: dict[str, float] = {}
    for v in root.findall("Valute"):
        code_el = v.find("CharCode")
        if code_el is None:
            continue
        code = (code_el.text or "").strip()
        nominal_el = v.find("Nominal")
        value_el = v.find("Value")
        nominal = int((nominal_el.text if nominal_el is not None else "1") or "1")
        raw_val = (value_el.text if value_el is not None else "0") or "0"
        val = float(raw_val.replace(",", "."))
        if nominal <= 0:
            continue
        official[code] = val / nominal
    return official, meta


def _ensure_rates_loaded() -> tuple[dict[str, float], str] | tuple[None, str]:
    global _cache_day, _cache_official, _cache_meta_date
    today = date.today().isoformat()
    with _lock:
        if _cache_day == today and _cache_official is not None and _cache_meta_date:
            return dict(_cache_official), _cache_meta_date

    try:
        with httpx.Client(timeout=20.0) as client:
            r = client.get(CBR_DAILY_URL)
            r.raise_for_status()
        official, meta = _parse_cbr_xml(r.content)
        with _lock:
            _cache_day = today
            _cache_official = official
            _cache_meta_date = meta
        return official, meta
    except Exception as e:
        return None, f"Не удалось получить курс: {e}"


def get_cbr_official_daily_rates() -> tuple[CbrDailyRates | None, str | None]:
    """
    Официальные котировки ЦБ без поправки — для таможенной стоимости и пересчёта EUR в пошлине.
    rub_per_unit['USD'] — рублей за 1 доллар и т.д.
    """
    official, meta_or_err = _ensure_rates_loaded()
    if official is None:
        return None, meta_or_err
    return CbrDailyRates(rub_per_unit=official, rate_date=meta_or_err), None


def get_cny_rub_rate() -> tuple[CbrCnyRate | None, str | None]:
    """CNY/RUB: курс продажи ВТБ Онлайн, ступень до 5 млн; fallback — официальный ЦБ без наценки."""
    from .vtb_rates import fetch_vtb_cny_sell_rate

    vtb, vtb_err = fetch_vtb_cny_sell_rate()
    if vtb is not None:
        return CbrCnyRate(rub_per_one_cny=vtb.rub_per_one_cny, rate_date=vtb.rate_date), None

    daily, err = get_cbr_official_daily_rates()
    if err or daily is None:
        return None, vtb_err or err
    cny = daily.rub_per_unit.get("CNY")
    if cny is None:
        return None, vtb_err or "В котировках не найдена валюта CNY"
    return CbrCnyRate(rub_per_one_cny=cny, rate_date=daily.rate_date), None
