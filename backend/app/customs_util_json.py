"""
JSON-таблицы коэффициентов утильсбора (ПП № 1291) для админки.

Формат version=1 совпадает с полями physical_person в YAML (util_ice_power_stairs, util_ev_power_stairs и скаляры).
Для юрлиц структура та же; при расчёте CTP льготы 3400/5200 и порог 80 л.с. для электро не применяются.
"""
from __future__ import annotations

import json
from typing import Any

ALLOWED_PP_KEYS_INDIVIDUAL = frozenset(
    {
        "util_ice_coeff_schedule",
        "util_recycling_base_rub",
        "util_hp_threshold",
        "util_under_3_le_hp",
        "util_over_3_le_hp",
        "util_ev_preferential_hp_max",
        "util_electric_coeff_schedule",
        "util_ice_power_stairs",
        "util_ev_power_stairs",
    }
)

ALLOWED_PP_KEYS_COMPANY = frozenset(
    {
        "util_ice_coeff_schedule",
        "util_recycling_base_rub",
        "util_electric_coeff_schedule",
        "util_ice_power_stairs",
        "util_ev_power_stairs",
    }
)


def _validate_ice_bands(bands: Any) -> str | None:
    if not isinstance(bands, dict):
        return "Ожидается объект полос объёма { «1000»|«2000»|...: [[л.с., K], ...] }."
    for bk, rows in bands.items():
        if not isinstance(bk, str) or not isinstance(rows, list):
            return f"Неверный формат полосы «{bk}» в util_ice_power_stairs."
        for row in rows:
            if not isinstance(row, (list, tuple)) or len(row) < 2:
                return "Строка таблицы ДВС должна быть [hp_to, coefficient]."
            try:
                int(row[0])
                float(row[1])
            except (TypeError, ValueError):
                return "В строке таблицы ДВС ожидаются числа [hp_to, coefficient]."
    return None


def _validate_stairs_structure(obj: Any) -> str | None:
    if not isinstance(obj, dict):
        return "util_ice_power_stairs должен быть объектом { расписание: { полоса_см3: [[л.с._до, K], ...] } } или с under_3 / from_3."
    for sk, sched_val in obj.items():
        if not isinstance(sk, str):
            return "Неверная структура util_ice_power_stairs."
        if not isinstance(sched_val, dict):
            return "Неверная структура util_ice_power_stairs."
        if ("under_3" in sched_val) ^ ("from_3" in sched_val):
            return "util_ice_power_stairs: для возрастных колонок укажите оба ключа under_3 и from_3."
        if "under_3" in sched_val and "from_3" in sched_val:
            u3, f3 = sched_val.get("under_3"), sched_val.get("from_3")
            if not isinstance(u3, dict) or not isinstance(f3, dict):
                return "util_ice_power_stairs: under_3 и from_3 должны быть объектами {полоса: [[л.с., K], ...]}."
            err = _validate_ice_bands(u3)
            if err:
                return err
            err = _validate_ice_bands(f3)
            if err:
                return err
        else:
            err = _validate_ice_bands(sched_val)
            if err:
                return err
    return None


def _validate_ev_stairs_rows(rows: Any) -> str | None:
    if not isinstance(rows, list):
        return "Неверная структура util_ev_power_stairs."
    for row in rows:
        if not isinstance(row, (list, tuple)) or len(row) < 2:
            return "Строка таблицы электро должна быть [hp_to, coefficient]."
        try:
            int(row[0])
            float(row[1])
        except (TypeError, ValueError):
            return "В строке таблицы электро ожидаются числа."
    return None


def _validate_ev_stairs(obj: Any) -> str | None:
    if not isinstance(obj, dict):
        return "util_ev_power_stairs должен быть объектом { расписание: [[л.с._до, K], ...] } или с under_3 / from_3."
    for sk, sched_val in obj.items():
        if not isinstance(sk, str):
            return "Неверная структура util_ev_power_stairs."
        if isinstance(sched_val, dict) and ("under_3" in sched_val or "from_3" in sched_val):
            if "under_3" not in sched_val or "from_3" not in sched_val:
                return "util_ev_power_stairs: укажите оба ключа under_3 и from_3."
            u3, f3 = sched_val.get("under_3"), sched_val.get("from_3")
            err = _validate_ev_stairs_rows(u3)
            if err:
                return err
            err = _validate_ev_stairs_rows(f3)
            if err:
                return err
        else:
            err = _validate_ev_stairs_rows(sched_val)
            if err:
                return err
    return None


def validate_util_individual_json(raw: str | None) -> str | None:
    if raw is None or not str(raw).strip():
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        return f"JSON (физлица): невалидный синтаксис: {e}"
    if not isinstance(data, dict):
        return "JSON (физлица): ожидается объект."
    ver = data.get("version")
    if ver is not None and ver != 1:
        return 'JSON (физлица): поддерживается только version: 1.'
    for k in data:
        if k == "version" or k == "description":
            continue
        if k not in ALLOWED_PP_KEYS_INDIVIDUAL:
            return f"JSON (физлица): неизвестный ключ «{k}»."
    if "util_ice_power_stairs" in data:
        err = _validate_stairs_structure(data["util_ice_power_stairs"])
        if err:
            return err
    if "util_ev_power_stairs" in data:
        err = _validate_ev_stairs(data["util_ev_power_stairs"])
        if err:
            return err
    return None


def validate_util_company_json(raw: str | None) -> str | None:
    if raw is None or not str(raw).strip():
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        return f"JSON (юрлица): невалидный синтаксис: {e}"
    if not isinstance(data, dict):
        return "JSON (юрлица): ожидается объект."
    ver = data.get("version")
    if ver is not None and ver != 1:
        return 'JSON (юрлица): поддерживается только version: 1.'
    for k in data:
        if k == "version" or k == "description":
            continue
        if k not in ALLOWED_PP_KEYS_COMPANY:
            return f"JSON (юрлица): неизвестный ключ «{k}»."
    if "util_ice_power_stairs" in data:
        err = _validate_stairs_structure(data["util_ice_power_stairs"])
        if err:
            return f"Юрлица: {err}"
    if "util_ev_power_stairs" in data:
        err = _validate_ev_stairs(data["util_ev_power_stairs"])
        if err:
            return f"Юрлица: {err}"
    return None


def apply_util_json_to_pp(payload: dict[str, Any], raw: str | None, *, allowed: frozenset[str]) -> None:
    """Накладывает поля из JSON на словарь physical_person (или отдельный pp для юрлиц)."""
    if not raw or not str(raw).strip():
        return
    data = json.loads(raw)
    for k, v in data.items():
        if k in ("version", "description"):
            continue
        if k in allowed:
            payload[k] = v


def build_default_util_json_individual() -> str:
    from .customs_physical import export_util_tables_as_dict

    d = export_util_tables_as_dict(individual=True)
    return json.dumps(d, ensure_ascii=False, indent=2)


def build_default_util_json_company() -> str:
    from .customs_physical import export_util_tables_as_dict

    d = export_util_tables_as_dict(individual=False)
    return json.dumps(d, ensure_ascii=False, indent=2)
