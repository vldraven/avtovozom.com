"""Курс продажи CNY в ВТБ Онлайн для витрины."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Any

import httpx

from .http_ssl import http_verify

VTB_CNY_TABLE_URL = (
    "https://www.vtb.ru/api/currencyrates/table/optimized?category=11&type=1"
)
# «В ВТБ Онлайн (С подпиской)», ступень до 5 млн ₽ эквивалента.
VTB_CNY_TIER_TOOLTIP = "до 5000000.00"
VTB_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
CACHE_TTL = timedelta(minutes=20)

_lock = Lock()
_cache_rate: float | None = None
_cache_date: str | None = None
_cache_until: datetime | None = None


@dataclass(frozen=True)
class VtbCnySellRate:
    rub_per_one_cny: float
    rate_date: str
    """Дата/время котировки ВТБ (удобный для UI формат)."""


def parse_vtb_cny_sell_offer(
    payload: dict[str, Any],
    *,
    tier_tooltip: str = VTB_CNY_TIER_TOOLTIP,
) -> VtbCnySellRate:
    """Достаёт offer (продажа банком) для CNY/RUB нужной ступени."""
    rates = payload.get("rates")
    if not isinstance(rates, list):
        raise ValueError("В ответе ВТБ нет списка rates")

    matched: dict[str, Any] | None = None
    for row in rates:
        if not isinstance(row, dict):
            continue
        c1 = row.get("currency1") if isinstance(row.get("currency1"), dict) else {}
        c2 = row.get("currency2") if isinstance(row.get("currency2"), dict) else {}
        codes = {(c1.get("code") or "").upper(), (c2.get("code") or "").upper()}
        if "CNY" not in codes or "RUB" not in codes:
            continue
        tip = str(row.get("tooltip") or "").strip()
        if tip == tier_tooltip:
            matched = row
            break

    if matched is None:
        raise ValueError(f"Не найдена ступень CNY с tooltip={tier_tooltip!r}")

    offer = matched.get("offer")
    if offer is None:
        raise ValueError("В строке CNY нет поля offer")
    scale = float(matched.get("scale") or 1)
    if scale <= 0:
        raise ValueError(f"Некорректный scale={scale}")
    rub = float(offer) / scale
    if rub <= 0:
        raise ValueError(f"Некорректный курс продажи={rub}")

    raw_from = payload.get("dateFrom")
    rate_date = _format_vtb_date(raw_from)
    return VtbCnySellRate(rub_per_one_cny=rub, rate_date=rate_date)


def _format_vtb_date(raw: Any) -> str:
    if not raw:
        return datetime.now(timezone.utc).astimezone().strftime("%d.%m.%Y")
    text = str(raw).strip()
    try:
        # 2026-08-11T09:20:00.194 or with Z
        normalized = text.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is None:
            return dt.strftime("%d.%m.%Y")
        return dt.astimezone().strftime("%d.%m.%Y")
    except ValueError:
        return text[:10] if len(text) >= 10 else text


def fetch_vtb_cny_sell_rate(*, force_refresh: bool = False) -> tuple[VtbCnySellRate | None, str | None]:
    """Актуальный курс продажи CNY (ВТБ Онлайн, ступень до 5 млн)."""
    global _cache_rate, _cache_date, _cache_until
    now = datetime.now(timezone.utc)
    with _lock:
        if (
            not force_refresh
            and _cache_rate is not None
            and _cache_date is not None
            and _cache_until is not None
            and now < _cache_until
        ):
            return VtbCnySellRate(rub_per_one_cny=_cache_rate, rate_date=_cache_date), None

    try:
        with httpx.Client(timeout=20.0, follow_redirects=True, verify=http_verify()) as client:
            r = client.get(
                VTB_CNY_TABLE_URL,
                headers={
                    "User-Agent": VTB_USER_AGENT,
                    "Accept": "application/json",
                },
            )
            r.raise_for_status()
            payload = r.json()
        if not isinstance(payload, dict):
            return None, "Ответ ВТБ не является JSON-объектом"
        parsed = parse_vtb_cny_sell_offer(payload)
        with _lock:
            _cache_rate = parsed.rub_per_one_cny
            _cache_date = parsed.rate_date
            _cache_until = now + CACHE_TTL
        return parsed, None
    except Exception as e:
        return None, f"Не удалось получить курс ВТБ: {e}"
