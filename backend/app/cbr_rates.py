"""Курсы валют к рублю по данным ЦБ РФ (ежедневный XML)."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date
from threading import Lock

import httpx

CBR_DAILY_URL = "https://www.cbr.ru/scripts/XML_daily.asp"

_lock = Lock()
_cache_day: str | None = None
_cache_rates: dict[str, float] | None = None
_cache_meta_date: str | None = None


@dataclass(frozen=True)
class CbrCnyRate:
    rub_per_one_cny: float
    """Сколько рублей за 1 китайский юань."""

    rate_date: str
    """Дата курса в XML ЦБ (часто dd.mm.yyyy)."""


@dataclass(frozen=True)
class CbrDailyRates:
    """Сколько рублей за 1 единицу иностранной валюты (CharCode → значение)."""

    rub_per_unit: dict[str, float]
    rate_date: str


def get_cbr_daily_rates() -> tuple[CbrDailyRates | None, str | None]:
    """
    Загружает котировки ЦБ (кэш на календарный день процесса).
    rub_per_unit['USD'] — рублей за 1 доллар и т.д.
    """
    global _cache_day, _cache_rates, _cache_meta_date
    today = date.today().isoformat()
    with _lock:
        if _cache_day == today and _cache_rates is not None and _cache_meta_date:
            return CbrDailyRates(rub_per_unit=dict(_cache_rates), rate_date=_cache_meta_date), None

    try:
        with httpx.Client(timeout=20.0) as client:
            r = client.get(CBR_DAILY_URL)
            r.raise_for_status()
        root = ET.fromstring(r.content)
        meta = (root.attrib.get("Date") or "").strip()
        m: dict[str, float] = {}
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
            m[code] = val / nominal
        with _lock:
            _cache_day = today
            _cache_rates = m
            _cache_meta_date = meta or today
        return CbrDailyRates(rub_per_unit=dict(m), rate_date=meta or today), None
    except Exception as e:
        return None, f"Не удалось получить курс ЦБ: {e}"


def get_cny_rub_rate() -> tuple[CbrCnyRate | None, str | None]:
    """
    Совместимость: только CNY/RUB.
    """
    daily, err = get_cbr_daily_rates()
    if err or daily is None:
        return None, err
    cny = daily.rub_per_unit.get("CNY")
    if cny is None:
        return None, "В котировках ЦБ не найдена валюта CNY"
    return CbrCnyRate(rub_per_one_cny=cny, rate_date=daily.rate_date), None
