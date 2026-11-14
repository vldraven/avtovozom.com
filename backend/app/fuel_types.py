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


def _iter_trim_source_items(raw_json: str | None):
    if not raw_json or not str(raw_json).strip():
        return
    try:
        sections = json.loads(raw_json)
    except (TypeError, ValueError, json.JSONDecodeError):
        return
    if not isinstance(sections, list):
        return
    for section in sections:
        if not isinstance(section, dict):
            continue
        for item in section.get("items") or []:
            if isinstance(item, dict):
                yield item


def horsepower_from_trim_source_json(raw_json: str | None) -> int | None:
    """Максимальная мощность (马力) из Autohome source_spec_json."""
    for item in _iter_trim_source_items(raw_json):
        name = str(item.get("name") or "")
        if "最大马力" not in name and name not in ("马力", "最大功率"):
            continue
        value = str(item.get("value") or "").strip()
        m = re.search(r"(\d{2,4})", value)
        if not m:
            continue
        hp = int(m.group(1))
        if "功率" in name and "马力" not in name and "kW" in value:
            # kW → л.с. приблизительно
            hp = int(round(hp * 1.35962))
        if 40 <= hp <= 2000:
            return hp
    return None


def horsepower_from_car_trim(trim: Any) -> int | None:
    if trim is None:
        return None
    for attr in ("source_spec_json", "spec_json"):
        hp = horsepower_from_trim_source_json(getattr(trim, attr, None))
        if hp:
            return hp
    return None


def _map_drive_type_label(raw: str | None) -> str | None:
    s = re.sub(r"\s+", "", str(raw or "").strip())
    if not s or s in ("--", "-", "—", "无", "暂无"):
        return None
    if s in ("Передний", "Задний", "Полный"):
        return s
    low = s.lower()
    if any(k in s for k in ("四驱", "四轮驱动", "全时四驱", "适时四驱", "分时四驱")) or "4wd" in low or "awd" in low:
        return "Полный"
    if any(k in s for k in ("后驱", "后轮驱动", "后置后驱")) or "rwd" in low:
        return "Задний"
    if any(k in s for k in ("前驱", "前置前驱", "前轮驱动")) or "fwd" in low:
        return "Передний"
    return None


def drive_type_from_trim_source_json(raw_json: str | None) -> str | None:
    """驱动方式 → Передний / Задний / Полный."""
    for item in _iter_trim_source_items(raw_json):
        name = str(item.get("name") or "")
        if "驱动方式" not in name and name not in ("驱动", "驱动形式", "Привод"):
            continue
        value = str(item.get("value") or "").strip()
        mapped = _map_drive_type_label(value)
        if mapped:
            return mapped
    return None


def drive_type_from_car_trim(trim: Any) -> str | None:
    if trim is None:
        return None
    for attr in ("source_spec_json", "spec_json", "spec_sections"):
        drive = drive_type_from_trim_source_json(getattr(trim, attr, None))
        if drive:
            return drive
    return None
