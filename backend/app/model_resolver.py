"""
Сопоставление объявления с CarModel по тексту карточки (а не только по URL серии whitelist).
"""

from __future__ import annotations

import re
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import CarModel


def _fuzzy_model_match(model_name: str, haystack: str, hay_lower: str) -> bool:
    mn = model_name.strip()
    if len(mn) < 2:
        return False
    mnl = mn.lower()
    if mnl not in hay_lower:
        return False
    if len(mn) <= 4:
        return bool(
            re.search(rf"(?i)(?<![A-Za-z0-9]){re.escape(mn)}(?![A-Za-z0-9])", haystack)
        )
    return True


def _find_model_by_name(db: Session, brand_id: int, name: str) -> int | None:
    row = (
        db.execute(
            select(CarModel).where(
                CarModel.brand_id == brand_id,
                func.lower(CarModel.name) == name.lower(),
            )
        )
        .scalar_one_or_none()
    )
    return row.id if row else None


def _try_bmw_series(db: Session, brand_id: int, haystack: str) -> int | None:
    """BMW: X1–X7, M3–M8, i3/i8, Z4, кит. «3系» → «3 Series»."""
    m = re.search(r"(?<![A-Za-z0-9])X([1-7])(?![0-9A-Za-z])", haystack, re.I)
    if m:
        mid = _find_model_by_name(db, brand_id, f"X{m.group(1)}")
        if mid is not None:
            return mid

    m = re.search(r"(?<![A-Za-z0-9])M([3-8])(?![0-9A-Za-z])", haystack, re.I)
    if m:
        mid = _find_model_by_name(db, brand_id, f"M{m.group(1)}")
        if mid is not None:
            return mid

    m = re.search(r"(?<![A-Za-z0-9])i([38])(?![0-9A-Za-z])", haystack)
    if m:
        mid = _find_model_by_name(db, brand_id, f"i{m.group(1)}")
        if mid is not None:
            return mid

    if re.search(r"(?<![A-Za-z0-9])Z4(?![0-9A-Za-z])", haystack, re.I):
        mid = _find_model_by_name(db, brand_id, "Z4")
        if mid is not None:
            return mid

    m = re.search(r"(?:宝马|BMW)[^\d]{0,10}(\d)\s*系", haystack, re.I)
    if not m:
        m = re.search(r"(?<![0-9])(\d)\s*系(?![0-9])", haystack)
    if m:
        mid = _find_model_by_name(db, brand_id, f"{m.group(1)} Series")
        if mid is not None:
            return mid

    m = re.search(r"(?:宝马|BMW)\s*X([1-7])\b", haystack, re.I)
    if m:
        mid = _find_model_by_name(db, brand_id, f"X{m.group(1)}")
        if mid is not None:
            return mid

    return None


def resolve_model_id_for_listing(
    db: Session,
    brand_name: str,
    brand_id: int,
    fallback_model_id: int,
    title: str | None,
    description: str | None,
    series_raw: str | None,
) -> int:
    """
    Выбирает model_id по тексту объявления; если уверенности нет — fallback (модель из whitelist URL).
    """
    parts = [title or "", description or "", series_raw or ""]
    haystack = " ".join(p for p in parts if p).strip()
    if not haystack:
        return fallback_model_id

    bn = (brand_name or "").strip().lower()
    if bn == "bmw":
        mid = _try_bmw_series(db, brand_id, haystack)
        if mid is not None:
            return mid

    models = (
        db.execute(
            select(CarModel)
            .where(CarModel.brand_id == brand_id)
            .order_by(func.length(CarModel.name).desc(), CarModel.name)
        )
        .scalars()
        .all()
    )

    hay_lower = haystack.lower()
    for m in models:
        if _fuzzy_model_match(m.name, haystack, hay_lower):
            return m.id
    return fallback_model_id
