"""Нормализация объёма двигателя для расчётов и каталога."""

from __future__ import annotations

# Легковые: сверх этого значения почти всегда ошибка парсера (напр. «20L» из «320Li»).
_MAX_PLAUSIBLE_PASSENGER_CC = 8000


def normalize_passenger_engine_volume_cc(cc: int | None) -> int:
    """
    Исправляет типичные ошибки парсинга (×10) и ограничивает нереалистичные значения.
    """
    if cc is None:
        return 0
    v = int(cc)
    if v <= 0:
        return 0
    if v <= _MAX_PLAUSIBLE_PASSENGER_CC:
        return v
    # 20000 → 2000 (ложное «20L» в названии комплектации)
    if v <= 25000 and v % 1000 == 0:
        scaled = v // 10
        if 400 <= scaled <= _MAX_PLAUSIBLE_PASSENGER_CC:
            return scaled
    return _MAX_PLAUSIBLE_PASSENGER_CC
