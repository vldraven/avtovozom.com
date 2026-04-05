"""Курс CNY/RUB по данным ЦБ РФ (ежедневный XML)."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date
from threading import Lock

import httpx

CBR_DAILY_URL = "https://www.cbr.ru/scripts/XML_daily.asp"

_lock = Lock()
_cache_day: str | None = None
_cache_rate: float | None = None
_cache_meta_date: str | None = None


@dataclass(frozen=True)
class CbrCnyRate:
    rub_per_one_cny: float
    """Сколько рублей за 1 китайский юань."""

    rate_date: str
    """Дата курса в XML ЦБ (часто dd.mm.yyyy)."""


def get_cny_rub_rate() -> tuple[CbrCnyRate | None, str | None]:
    """
    Возвращает (курс, None) или (None, сообщение_об_ошибке).
    Кэш на календарный день процесса (UTC+локаль — по date.today() сервера).
    """
    global _cache_day, _cache_rate, _cache_meta_date
    today = date.today().isoformat()
    with _lock:
        if _cache_day == today and _cache_rate is not None and _cache_meta_date:
            return CbrCnyRate(rub_per_one_cny=_cache_rate, rate_date=_cache_meta_date), None

    try:
        with httpx.Client(timeout=20.0) as client:
            r = client.get(CBR_DAILY_URL)
            r.raise_for_status()
        root = ET.fromstring(r.content)
        meta = (root.attrib.get("Date") or "").strip()
        for v in root.findall("Valute"):
            code_el = v.find("CharCode")
            if code_el is None or (code_el.text or "").strip() != "CNY":
                continue
            nominal_el = v.find("Nominal")
            value_el = v.find("Value")
            nominal = int((nominal_el.text if nominal_el is not None else "1") or "1")
            raw_val = (value_el.text if value_el is not None else "0") or "0"
            val = float(raw_val.replace(",", "."))
            if nominal <= 0:
                return None, "Некорректный Nominal для CNY в ответе ЦБ"
            rub_per_one = val / nominal
            with _lock:
                _cache_day = today
                _cache_rate = rub_per_one
                _cache_meta_date = meta or today
            return CbrCnyRate(rub_per_one_cny=rub_per_one, rate_date=meta or today), None
    except Exception as e:
        return None, f"Не удалось получить курс ЦБ: {e}"

    return None, "В котировках ЦБ не найдена валюта CNY"
