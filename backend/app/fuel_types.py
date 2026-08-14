"""Канонические fuel_type для карточки: бензин / дизель / гибрид / электро."""

from __future__ import annotations

import json
import re
from typing import Any

CANONICAL_FUEL_TYPES = ("бензин", "дизель", "гибрид", "электро")

# Гибрид раньше электро: «plug-in hybrid electric» не должен стать электро.
_FUEL_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "гибрид",
        (
            "插电式混合动力",
            "插电混动",
            "油电混合",
            "混合动力",
            "plug-in",
            "plug in",
            "гибрид",
            "hybrid",
            "phev",
            "hev",
            "轻混",
            "增程式",
            "增程",
            "插电",
            "混动",
        ),
    ),
    (
        "электро",
        ("纯电动", "纯电", "электромобил", "электрич", "electric", "электро", "bev"),
    ),
    ("дизель", ("柴油", "дизель", "diesel")),
    ("бензин", ("汽油", "бензин", "petrol", "gasoline")),
)


def normalize_fuel_type_ru(raw: str | None) -> str | None:
    s = re.sub(r"\s+", " ", str(raw or "").strip().lower())
    if not s:
        return None
    if s in CANONICAL_FUEL_TYPES:
        return s
    for canonical, keys in _FUEL_RULES:
        if any(k in s for k in keys):
            return canonical
    return None


def fuel_from_trim_source_json(raw_json: str | None) -> str | None:
    """Достать топливо из Autohome source_spec_json (поле 能源类型)."""
    if not raw_json or not str(raw_json).strip():
        return None
    try:
        sections = json.loads(raw_json)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(sections, list):
        return None
    for section in sections:
        if not isinstance(section, dict):
            continue
        for item in section.get("items") or []:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "")
            if "能源类型" not in name and "燃料类型" not in name and "燃油类型" not in name:
                continue
            value = str(item.get("value") or "").strip()
            fuel = normalize_fuel_type_ru(value)
            if fuel:
                return fuel
    return None


def fuel_from_car_trim(trim: Any) -> str | None:
    if trim is None:
        return None
    for attr in ("source_spec_json", "spec_json"):
        fuel = fuel_from_trim_source_json(getattr(trim, attr, None))
        if fuel:
            return fuel
    return None
