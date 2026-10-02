"""Каноническая КПП для карточки: автомат / механика / вариатор / робот DCT.

Отсекает мусор вроде «运转良好» (состояние авто, ошибочно попавшее в gearbox).
"""

from __future__ import annotations

import re

from .trim_display import format_gearbox_value_ru, looks_like_gearbox_value

_HAS_CJK = re.compile(r"[\u4e00-\u9fff]")
_LATIN_GEARBOX = frozenset({"AT", "MT", "CVT", "DCT", "AMT", "DSG"})

# Фразы состояния / сервиса, которые che168 иногда кладёт в поле gearbox.
_TRANSMISSION_JUNK_MARKERS = (
    "运转",
    "车况",
    "状况良好",
    "无事故",
    "保养",
    "维修",
    "检测",
    "正常行驶",
)

_PLACEHOLDERS = frozenset({"", "-", "--", "—", "无", "未知", "暂无", "null", "none"})

_RU_DCT_RE = re.compile(
    r"\bDCT\b|двойн\w*\s+сцеплен|преселектив|робот",
    re.IGNORECASE,
)
_RU_CVT_RE = re.compile(r"вариатор|\bCVT\b", re.IGNORECASE)
_RU_MT_RE = re.compile(r"механ|\bMT\b", re.IGNORECASE)
_RU_AT_RE = re.compile(r"автомат|\bAT\b|АКПП", re.IGNORECASE)
_GEARS_LIKE_RE = re.compile(r"(?i)\b(AT|MT|CVT|DCT|AMT|DSG)\b|\d+\s*[-–]?\s*(ступенч|speed)")


def _cap_first(s: str) -> str:
    if not s:
        return s
    return s[0].upper() + s[1:] if len(s) > 1 else s.upper()


def is_junk_transmission(raw: str | None) -> bool:
    s = str(raw or "").strip()
    if not s or s.lower() in _PLACEHOLDERS:
        return True
    if any(m in s for m in _TRANSMISSION_JUNK_MARKERS) and not looks_like_gearbox_value(s):
        return True
    return False


def shorten_transmission_display(value: str) -> str:
    """Длинные русские описания DCT/AT → короткая метка для блока характеристик."""
    s = str(value or "").strip()
    if not s:
        return s
    if _RU_CVT_RE.search(s):
        return "Вариатор"
    if _RU_DCT_RE.search(s):
        return "Робот DCT"
    if _RU_MT_RE.search(s) and not _RU_AT_RE.search(s):
        return "Механика"
    if _RU_AT_RE.search(s):
        return "Автомат"
    return s


def normalize_transmission_ru(raw: str | None) -> str | None:
    """
    Нормализует КПП для хранения/выдачи API.
    Мусор и непереведённые иероглифы без признаков коробки → None.
    """
    s = str(raw or "").strip()
    if not s or s.lower() in _PLACEHOLDERS:
        return None
    if is_junk_transmission(s):
        return None

    if (
        looks_like_gearbox_value(s)
        or s.upper() in _LATIN_GEARBOX
        or _HAS_CJK.search(s)
        or _GEARS_LIKE_RE.search(s)
    ):
        out = format_gearbox_value_ru(s)
        out = (out or "").strip()
        if not out or _HAS_CJK.search(out):
            return None
        return _cap_first(shorten_transmission_display(out))

    shortened = shorten_transmission_display(s)
    return _cap_first(shortened) if shortened else None



def transmission_from_trim_sections(
    sections: list | None,
    param_sections: list | None = None,
) -> str | None:
    """Достаёт КПП из trim (Тип КПП / Коробка передач)."""
    prefer_names = ("тип кпп", "коробка передач", "кпп")
    found: list[tuple[int, str]] = []
    for bag in (param_sections or [], sections or []):
        if not isinstance(bag, list):
            continue
        for sec in bag:
            if not isinstance(sec, dict):
                continue
            for item in sec.get("items") or []:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name") or "").strip().casefold()
                value = str(item.get("value") or "").strip()
                if not value:
                    continue
                for i, label in enumerate(prefer_names):
                    if name == label or label in name:
                        found.append((i, value))
                        break
    if not found:
        return None
    found.sort(key=lambda x: x[0])
    return normalize_transmission_ru(found[0][1])
