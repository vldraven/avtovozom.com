from __future__ import annotations

import os
import tempfile
from typing import Any

import yaml
from tks_api_official.calc import CustomsCalculator

from .cbr_rates import get_cbr_daily_rates
from .customs_physical import clearance_fee_rub, compute_etc_individual
from .models import CustomsCalcSettings
from .schemas import CustomsCalcEstimateIn, CustomsCalcEstimateOut, CustomsCalcEtcContext, CustomsCalcSummary


def _patch_calculator_currency_to_cbr(calc: CustomsCalculator) -> None:
    """
    tks-api использует currency_converter_free; на части окружений 1 EUR ошибочно даёт ~1 RUB.
    Подменяем конвертацию на курсы ЦБ РФ из того же источника, что и остальной сайт.
    """
    daily, err = get_cbr_daily_rates()
    if err or not daily:
        return
    rates = daily.rub_per_unit
    orig = calc.convert_to_local_currency

    def convert(amount: float, currency: str = "EUR") -> float | None:
        cur = (currency or "EUR").upper().strip()
        if cur == "RUB":
            try:
                return float(amount)
            except (TypeError, ValueError):
                return None
        rpu = rates.get(cur)
        if rpu is None:
            return orig(amount, currency)
        try:
            return float(amount) * float(rpu)
        except (TypeError, ValueError):
            return None

    calc.convert_to_local_currency = convert  # type: ignore[method-assign]

def _sum_etc_components(row: dict[str, Any]) -> float:
    return (
        float(row.get("Clearance Fee (RUB)") or 0)
        + float(row.get("Duty (RUB)") or 0)
        + float(row.get("Utilization Fee (RUB)") or row.get("Recycling Fee (RUB)") or 0)
        + float(row.get("Util Fee (RUB)") or 0)
    )


def _sum_ctp_components(row: dict[str, Any]) -> float:
    return (
        float(row.get("Duty (RUB)") or 0)
        + float(row.get("Excise (RUB)") or 0)
        + float(row.get("VAT (RUB)") or 0)
        + float(row.get("Clearance Fee (RUB)") or 0)
        + float(row.get("Util Fee (RUB)") or 0)
    )


def _postprocess_etc(
    etc: dict[str, Any],
    calc: CustomsCalculator,
    payload: CustomsCalcEstimateIn,
    tariffs: dict[str, Any],
) -> dict[str, Any]:
    """
    tks-api всегда кладёт фиксированный base_clearance_fee и полный base_util_fee в ETC и не смотрит на owner_type.
    Для физлица подменяем сбор по ступеням от таможенной стоимости в ₽ и убираем лишнее «Util Fee» (настраивается).
    """
    out = dict(etc)
    price_rub = calc.convert_to_local_currency(payload.price, payload.currency.upper())
    if price_rub is not None:
        out["Clearance Fee (RUB)"] = clearance_fee_rub(float(price_rub), tariffs)

    if payload.owner_type == "individual":
        try:
            out["Util Fee (RUB)"] = float(tariffs.get("individual_etc_util_fee", 0))
        except (TypeError, ValueError):
            out["Util Fee (RUB)"] = 0.0
        ir = tariffs.get("individual_recycling_rub", None)
        if ir is not None and ir != "":
            try:
                out["Recycling Fee (RUB)"] = float(ir)
            except (TypeError, ValueError):
                pass
    out["Total Pay (RUB)"] = _sum_etc_components(out)
    return out


def _build_etc_context_physical(
    payload: CustomsCalcEstimateIn,
    etc: dict[str, Any],
    meta: dict[str, Any],
) -> CustomsCalcEtcContext:
    """Контекст после расчёта для физлица (customs_physical)."""
    u = _safe_float(etc.get("Utilization Fee (RUB)"))
    um = meta.get("utilization_mode") or ""
    hint_util = (
        "Утилизация (ПП 1291): до порога мощности — льготные суммы; иначе база × один коэффициент из таблицы (объём×мощность / электро)."
    )
    return CustomsCalcEtcContext(
        age=payload.age,
        engine_type=payload.engine_type,
        engine_capacity_cc=payload.engine_capacity,
        customs_value_rub=_safe_float(etc.get("Customs value (RUB)")),
        customs_value_eur=_safe_float(meta.get("customs_value_eur")),
        duty_mode=meta.get("duty_mode") or "",
        duty_percent=meta.get("duty_percent"),
        duty_min_eur_per_cc=meta.get("duty_min_eur_per_cc"),
        rate_per_cc_eur=meta.get("rate_per_cc_eur"),
        duty_rub=_safe_float(etc.get("Duty (RUB)")),
        utilization_fee_rub=u,
        recycling_fee_rub=u,
        clearance_fee_rub=_safe_float(etc.get("Clearance Fee (RUB)")),
        util_fee_rub=0.0,
        utilization_mode=um if isinstance(um, str) else None,
        hint=(
            "Пошлина — по ЕТТ (как в справочниках). "
            + hint_util
            + " Таможенное оформление — ступени ПП № 1637."
        ),
    )


def _build_etc_context(
    tariffs: dict[str, Any],
    payload: CustomsCalcEstimateIn,
    etc: dict[str, Any],
) -> CustomsCalcEtcContext:
    """Показывает фактическую ставку из YAML (режим юрлица / tks)."""
    ov = (tariffs.get("age_groups") or {}).get("overrides") or {}

    def _rate_for(age_key: str) -> float | None:
        g = ov.get(age_key) or {}
        t = g.get(payload.engine_type) or {}
        v = t.get("rate_per_cc")
        if v is None:
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    cur = _rate_for(payload.age)
    ages_in_cfg = [k for k in ov.keys() if isinstance(k, str)]
    same = sorted([a for a in ages_in_cfg if _rate_for(a) == cur and cur is not None])
    hint = ""
    if len(same) > 1:
        hint = (
            f"Для «{payload.engine_type}» в YAML одинаковая ставка rate_per_cc = {cur} EUR/см³ "
            f"для возрастов: {', '.join(same)}. Пошлина при том же объёме совпадает; итог ETC может отличаться "
            f"из‑за recycling_factors. Часто «Новый», «1–3» и «3–5» заданы одной ставкой — переключение между ними "
            f"не меняет сумму; сравните с «5–7» / «Старше 7», где обычно другая rate_per_cc."
        )

    rec = _safe_float(etc.get("Recycling Fee (RUB)"))
    return CustomsCalcEtcContext(
        age=payload.age,
        engine_type=payload.engine_type,
        engine_capacity_cc=payload.engine_capacity,
        customs_value_rub=None,
        duty_mode="tks_yaml",
        duty_percent=None,
        rate_per_cc_eur=cur,
        duty_rub=_safe_float(etc.get("Duty (RUB)")),
        utilization_fee_rub=rec,
        recycling_fee_rub=rec,
        clearance_fee_rub=_safe_float(etc.get("Clearance Fee (RUB)")),
        util_fee_rub=_safe_float(etc.get("Util Fee (RUB)")),
        hint=hint,
    )


def _safe_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _postprocess_ctp(
    ctp: dict[str, Any],
    calc: CustomsCalculator,
    payload: CustomsCalcEstimateIn,
    tariffs: dict[str, Any],
) -> dict[str, Any]:
    """Ступени таможенного сбора по стоимости в ₽ (как в законодательстве; tks это не подставляет в calculate_ctp)."""
    out = dict(ctp)
    price_rub = calc.convert_to_local_currency(payload.price, payload.currency.upper())
    if price_rub is not None:
        out["Clearance Fee (RUB)"] = clearance_fee_rub(float(price_rub), tariffs)
    out["Total Pay (RUB)"] = _sum_ctp_components(out)
    return out

# Дефолт при первом создании строки в БД. Комментарии # допустимы; API хранит текст как есть (без yaml.dump).
# Справка по заполнению: docs/CUSTOMS_CALCULATOR_CONFIG.md
DEFAULT_TKS_CONFIG_YAML = """# Конфиг tks-api-official: корень tariffs обязателен.
# ETC (ответ etc): пошлина ≈ rate_per_cc × объём_см³ × курс(1 EUR→RUB) + сборы (см. исходники tks_api_official/calc.py).
# CTP (ответ ctp): упрощённо для юрлица — пошлина max(20%% цены, 0,44 EUR/см³×объём), НДС 20%%, акциз power×ставка и т.д.
#
tariffs:
  # Таможенный сбор за оформление (₽). В модели одна сумма; по закону ступени зависят от таможенной стоимости.
  base_clearance_fee: 3100
  # Слагаемое «Util Fee» в ETC; в CTP умножается на ctp_util_coeff_base. Не тождественно утильсбору по ПП РФ.
  base_util_fee: 20000
  # Не используется кодом tks-api-official в calculate_etc (оставлено для совместимости с config.yaml апстрима).
  etc_util_coeff_base: 1.0
  # Только CTP: util_fee = base_util_fee × это значение.
  ctp_util_coeff_base: 1.2
  # ETC при «Кто ввозит: физлицо»: подмена строки Util Fee (tks иначе всегда добавляет полный base_util_fee).
  individual_etc_util_fee: 0
  # Необязательно: задать утилизационный сбор для ETC физлица в ₽ вместо 20000×factor. Пример: 5200
  # individual_recycling_rub:

  # Физлицо (ЕТС): расчёт вне tks — пошлина по возрасту + утилизация + ступени ПП № 1637 (см. customs_physical.py).
  physical_person:
    # Пошлина: ЕТТ ЕАЭС (см. customs_physical.py). До 3 лет — ступени по тамож. стоимости в EUR + max(%, мин. €/см³).
    # Старше 3 лет — €/см³ по диапазонам объёма (доски 3–5 / 5–7 / 7+ различаются). Переопределение: duty_under_3_eur_brackets,
    # duty_eur_per_cc_bands_3_5, duty_eur_per_cc_bands_5_7, duty_eur_per_cc_bands_over_7.
    duty_electric_percent_under_3: 15
    util_hp_threshold: 160
    util_under_3_le_hp: 3400
    util_over_3_le_hp: 5200
    util_recycling_base_rub: 20000
    # УС = util_recycling_base_rub × K. Расписание таблиц: 2026-01 | 2025-12 (коэффициенты перечня ПП № 1291).
    util_ice_coeff_schedule: "2026-01"
    util_ev_preferential_hp_max: 80
    # Переопределение ступеней: util_ice_power_stairs: { "2026-01": { "2000": [[70, 58.7], [100, 58.7], ...] }, ... }
    # Опционально: ступени таможенного сбора [[порог_стоимости_₽, сбор_₽], ...] — ПП № 1637.

  # CTP: акциз = мощность_л.с. × ставка (₽/л.с.). В НК РФ — ступени по мощности; здесь одно число на тип двигателя.
  excise_rates:
    gasoline: 63
    diesel: 63
    electric: 0
    hybrid: 63

  # В библиотеке: 20000 ₽ × коэффициент. Упрощение относительно ПП РФ № 1291 / № 81.
  recycling_factors:
    default:
      gasoline: 1.0
      diesel: 1.0
      electric: 0.3
      hybrid: 0.9
    adjustments:
      "5-7":
        gasoline: 0.26
        diesel: 0.26
        electric: 0.26
        hybrid: 0.26

  # rate_per_cc подобрано под эталон объёма ~2000 см³ (ряд 1801–2300 см³ в таблицах ЕТТ для физлиц): 3–5 лет 2,7; 5+ лет 4,8 EUR/см³.
  # Для других объёмов и для авто «до 3 лет» по закону — другие правила; сверяйте с официальными таблицами.
  # min_duty парсером калькулятора не используется (только справочно для администратора).
  age_groups:
    overrides:
      "new":
        gasoline:
          rate_per_cc: 2.7
          min_duty: 0
        diesel:
          rate_per_cc: 2.7
          min_duty: 0
        electric:
          rate_per_cc: 0
          min_duty: 0
        hybrid:
          rate_per_cc: 2.7
          min_duty: 0
      "1-3":
        gasoline:
          rate_per_cc: 2.7
          min_duty: 0
        diesel:
          rate_per_cc: 2.7
          min_duty: 0
        electric:
          rate_per_cc: 0
          min_duty: 0
        hybrid:
          rate_per_cc: 2.7
          min_duty: 0
      "3-5":
        gasoline:
          rate_per_cc: 2.7
          min_duty: 0
        diesel:
          rate_per_cc: 2.7
          min_duty: 0
        electric:
          rate_per_cc: 0
          min_duty: 0
        hybrid:
          rate_per_cc: 2.7
          min_duty: 0
      "5-7":
        gasoline:
          rate_per_cc: 4.8
          min_duty: 0
        diesel:
          rate_per_cc: 4.8
          min_duty: 0
        electric:
          rate_per_cc: 0
          min_duty: 1000
        hybrid:
          rate_per_cc: 2.0
          min_duty: 2500
      "over_7":
        gasoline:
          rate_per_cc: 4.8
          min_duty: 0
        diesel:
          rate_per_cc: 4.8
          min_duty: 0
        electric:
          rate_per_cc: 0
          min_duty: 1500
        hybrid:
          rate_per_cc: 3.0
          min_duty: 3000
"""


def validate_config_yaml(config_yaml: str) -> tuple[dict[str, Any] | None, str | None]:
    try:
        parsed = yaml.safe_load(config_yaml) or {}
    except Exception as e:
        return None, f"YAML parse error: {e}"
    if not isinstance(parsed, dict) or "tariffs" not in parsed:
        return None, "В YAML должен быть корневой объект с ключом tariffs."
    try:
        # Валидация через сам калькулятор: сможет ли прочитать конфиг.
        with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8", suffix=".yaml") as f:
            f.write(config_yaml)
            path = f.name
        try:
            CustomsCalculator(path)
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass
    except Exception as e:
        return None, f"Некорректный конфиг для tks-api: {e}"
    return parsed, None


def ensure_settings_row(db) -> CustomsCalcSettings:
    row = db.get(CustomsCalcSettings, 1)
    if row is None:
        row = CustomsCalcSettings(id=1, config_yaml=DEFAULT_TKS_CONFIG_YAML)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def run_estimate(
    config_yaml: str,
    payload: CustomsCalcEstimateIn,
    *,
    util_individual_json: str | None = None,
    util_company_json: str | None = None,
) -> CustomsCalcEstimateOut:
    tariffs_cfg = yaml.safe_load(config_yaml) or {}
    tariffs = dict(tariffs_cfg.get("tariffs") or {})
    pp_cfg = dict(tariffs.get("physical_person") or {})
    if util_individual_json and str(util_individual_json).strip():
        from .customs_util_json import ALLOWED_PP_KEYS_INDIVIDUAL, apply_util_json_to_pp

        apply_util_json_to_pp(pp_cfg, util_individual_json, allowed=ALLOWED_PP_KEYS_INDIVIDUAL)
    tariffs["physical_person"] = pp_cfg

    daily, derr = get_cbr_daily_rates()
    if derr or not daily:
        raise ValueError(f"Не удалось получить курсы ЦБ: {derr}")

    with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8", suffix=".yaml") as f:
        f.write(config_yaml)
        cfg_path = f.name
    try:
        calc = CustomsCalculator(cfg_path)
        _patch_calculator_currency_to_cbr(calc)
        calc.set_vehicle_details(
            age=payload.age,
            engine_capacity=payload.engine_capacity,
            engine_type=payload.engine_type,
            power=payload.power,
            price=payload.price,
            owner_type=payload.owner_type,
            currency=payload.currency,
        )

        if payload.owner_type == "individual":
            etc, meta = compute_etc_individual(
                age=payload.age,
                engine_type=payload.engine_type,
                engine_capacity=payload.engine_capacity,
                power=payload.power,
                price=payload.price,
                currency=payload.currency,
                daily=daily,
                tariffs=tariffs,
            )
            etc_context = _build_etc_context_physical(payload, etc, meta)
            note = (
                "Пошлина — по ЕТТ; оформление — ПП № 1637; утилизация — ПП № 1291: УС = базовая ставка × коэффициент из перечня "
                "(по объёму и мощности для ДВС; график задаётся в конфиге, по умолчанию актуальные ступени). "
                "До порога мощности — льготные суммы из конфига."
            )
        else:
            etc = _postprocess_etc(calc.calculate_etc(), calc, payload, tariffs)
            etc_context = _build_etc_context(tariffs, payload, etc)
            note = (
                "Для юрлица ориентируйтесь на блок CTP. Таможенный сбор — по ступеням от стоимости в ₽; "
                "пошлина/НДС/акциз — упрощённая модель tks, не полный ЕТТ."
            )

        ctp = _postprocess_ctp(calc.calculate_ctp(), calc, payload, tariffs)
        if payload.owner_type == "company" and util_company_json and str(util_company_json).strip():
            from .customs_physical import utilization_company_fee
            from .customs_util_json import ALLOWED_PP_KEYS_COMPANY, apply_util_json_to_pp

            pp_co: dict[str, Any] = {}
            apply_util_json_to_pp(pp_co, util_company_json, allowed=ALLOWED_PP_KEYS_COMPANY)
            if pp_co:
                fee_u, _k, _m = utilization_company_fee(
                    payload.power,
                    float(payload.engine_capacity),
                    payload.engine_type,
                    pp_co,
                    age=payload.age,
                )
                ctp = dict(ctp)
                ctp["Util Fee (RUB)"] = fee_u
                ctp["Total Pay (RUB)"] = _sum_ctp_components(ctp)
                note = (
                    "CTP: пошлина/НДС/акциз — модель tks. Утилизационный сбор пересчитан по JSON-таблицам "
                    "для юрлиц из админки (УС = база × коэффициент)."
                )

        primary = "etc" if payload.owner_type == "individual" else "ctp"

        if primary == "etc":
            summary = CustomsCalcSummary(
                clearance_fee_rub=float(etc.get("Clearance Fee (RUB)") or 0),
                duty_rub=float(etc.get("Duty (RUB)") or 0),
                utilization_fee_rub=float(etc.get("Utilization Fee (RUB)") or 0),
                total_rub=float(etc.get("Total Pay (RUB)") or 0),
            )
        else:
            duty_only = float(ctp.get("Duty (RUB)") or 0)
            excise = float(ctp.get("Excise (RUB)") or 0)
            vat = float(ctp.get("VAT (RUB)") or 0)
            summary = CustomsCalcSummary(
                clearance_fee_rub=float(ctp.get("Clearance Fee (RUB)") or 0),
                duty_rub=duty_only + excise + vat,
                utilization_fee_rub=float(ctp.get("Util Fee (RUB)") or 0),
                total_rub=float(ctp.get("Total Pay (RUB)") or 0),
            )

        return CustomsCalcEstimateOut(
            etc=etc,
            ctp=ctp,
            disclaimer=(
                "Результат справочный. Окончательная сумма таможенных платежей и утилизационного "
                "сбора определяется таможенными органами."
            ),
            primary_mode=primary,
            calculation_note=note,
            etc_context=etc_context,
            summary=summary,
        )
    finally:
        try:
            os.unlink(cfg_path)
        except OSError:
            pass
