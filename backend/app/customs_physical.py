"""
Расчёт таможенных платежей для физлица (ЕТС) по ЕТТ ЕАЭС и ПП РФ.

Пошлина (легковые, бензин/дизель/гибрид с ДВС): до 3 лет — max(%×тамож. стоимость в ₽, мин. €/см³×см³×курс)
  по ступеням таможенной стоимости в EUR; 3–5 / 5–7 / старше 7 лет — €/см³ по диапазонам объёма (таблицы как на
  drom.ru/customs/cartable.php §3). Электромобиль до 3 лет — процент от стоимости (по умолчанию 15%); старше — опционально €/кВт.

Таможенный сбор за оформление — ступени ПП РФ № 1637 (ред. консультант LAW_491874); правка через YAML.

Утилизационный сбор (ПП № 1291): льгота для физлиц до порога мощности (по умолч. 160 л.с. ДВС, 80 л.с. электро);
выше — УС = базовая ставка × **один** коэффициент из перечня (зависит от объёма двигателя и мощности; графики в конфиге).
"""
from __future__ import annotations

from typing import Any

from .cbr_rates import CbrDailyRates

# ПП РФ № 1637 в ред. от 27.11.2025 (база — таможенная стоимость в ₽; при изменении — YAML clearance_tiers).
# Сверка: consultant.ru LAW_491874, публичные таблицы (tks.ru, Дром).
_DEFAULT_CLEARANCE_TIERS_RUB: list[tuple[float, float]] = [
    (200_000, 1231),
    (450_000, 2462),
    (1_200_000, 4924),
    (2_700_000, 13541),
    (4_200_000, 18465),
    (5_500_000, 21344),
    (10_000_000, 49240),
    (float("inf"), 73860),
]

# ЕТТ ЕАЭС — физлица, бензин/дизель (единая таблица по объёму для 3–7+ лет на drom.ru/customs/cartable.php §3.2–3.4).
# До 3 лет: §3.1 — доля от стоимости и минимум €/см³ по ступеням таможенной стоимости в евро.
_DEFAULT_DUTY_UNDER3_EUR_BRACKETS: list[tuple[float, float, float]] = [
    (8500.0, 54.0, 2.5),
    (16700.0, 48.0, 3.5),
    (42300.0, 48.0, 5.5),
    (84500.0, 48.0, 7.5),
    (169000.0, 48.0, 15.0),
    (float("inf"), 48.0, 20.0),
]

# Верхняя граница см³ → ставка €/см³ (если объём ≤ границы, применяется эта ставка).
_DEFAULT_EUR_CC_3_5: list[tuple[float, float]] = [
    (1000, 1.5),
    (1500, 1.7),
    (1800, 2.5),
    (2300, 2.7),
    (3000, 3.0),
    (10**12, 3.6),
]
_DEFAULT_EUR_CC_5_7: list[tuple[float, float]] = [
    (1000, 3.0),
    (1500, 3.2),
    (1800, 3.5),
    (2300, 4.8),
    (3000, 5.0),
    (10**12, 5.7),
]
# Старше 7 лет: границы 1801–2500 и 2501–3000 отличаются от 5–7 лет (§3.4 Дром).
_DEFAULT_EUR_CC_OVER_7: list[tuple[float, float]] = [
    (1000, 3.0),
    (1500, 3.2),
    (1800, 3.5),
    (2500, 4.8),
    (3000, 5.0),
    (10**12, 5.7),
]

# ---------------------------------------------------------------------------
# Утилизационный сбор: УС = базовая ставка × K. Коэффициент K — из таблиц перечня к ПП № 1291
# (зависит от рабочего объёма ДВС и мощности; для электро / последовательного гибрида — от мощности).
# Значения ниже — ориентир по графикам, в т.ч. публикациям вроде gt-news.ru (янв. 2026 / дек. 2025);
# актуальные цифры можно подменить в YAML: physical_person.util_ice_power_stairs и util_ev_power_stairs.
# ---------------------------------------------------------------------------

# Для каждой строки: power <= hp_to л.с. → коэффициент K (список по возрастанию hp_to).
_UTIL_ICE_STAIRS_2026_01: dict[str, list[tuple[int, float]]] = {
    "1000": [
        (70, 23.0),
        (100, 23.0),
        (130, 23.0),
        (160, 23.0),
        (190, 23.69),
        (220, 24.4),
        (250, 25.1),
        (280, 25.1),
        (310, 25.1),
        (340, 25.1),
        (370, 25.1),
        (400, 25.1),
        (430, 25.1),
        (460, 25.1),
        (500, 25.1),
        (999_999, 25.1),
    ],
    "2000": [
        (70, 58.7),
        (100, 58.7),
        (130, 58.7),
        (160, 58.7),
        (190, 62.2),
        (220, 66.0),
        (250, 69.9),
        (280, 76.6),
        (310, 83.8),
        (340, 91.8),
        (370, 100.5),
        (400, 110.0),
        (430, 120.5),
        (460, 132.0),
        (500, 144.5),
        (999_999, 158.2),
    ],
    "3000": [
        (70, 141.97),
        (100, 141.97),
        (130, 141.97),
        (160, 141.97),
        (190, 144.0),
        (220, 145.9),
        (250, 148.0),
        (280, 152.5),
        (310, 157.1),
        (340, 161.4),
        (370, 165.9),
        (400, 170.6),
        (430, 175.4),
        (460, 180.3),
        (500, 185.3),
        (999_999, 190.5),
    ],
    "3500": [
        (70, 164.84),
        (100, 164.84),
        (130, 164.84),
        (160, 164.84),
        (190, 166.7),
        (220, 168.5),
        (250, 170.3),
        (280, 172.7),
        (310, 177.0),
        (340, 181.5),
        (370, 186.9),
        (400, 192.5),
        (430, 198.3),
        (460, 204.2),
        (500, 210.4),
        (999_999, 216.7),
    ],
    "3501": [
        (70, 180.246),
        (100, 180.246),
        (130, 180.246),
        (160, 180.246),
        (190, 182.96),
        (220, 185.76),
        (250, 188.56),
        (280, 192.86),
        (310, 197.26),
        (340, 208.6),
        (370, 219.56),
        (400, 231.66),
        (430, 244.36),
        (460, 257.86),
        (500, 272.6),
        (999_999, 286.96),
    ],
}

_UTIL_ICE_STAIRS_2025_12: dict[str, list[tuple[int, float]]] = {
    "1000": [
        (70, 12.4),
        (100, 12.4),
        (130, 12.4),
        (160, 12.4),
        (190, 12.8),
        (220, 13.2),
        (250, 13.5),
        (280, 14.4),
        (310, 14.4),
        (340, 14.4),
        (370, 14.4),
        (400, 14.4),
        (430, 14.4),
        (460, 14.4),
        (500, 14.4),
        (999_999, 14.4),
    ],
    "2000": [
        (70, 33.37),
        (100, 33.37),
        (130, 33.37),
        (160, 33.37),
        (190, 37.5),
        (220, 39.7),
        (250, 42.1),
        (280, 47.6),
        (310, 53.8),
        (340, 60.8),
        (370, 69.3),
        (400, 79.0),
        (430, 90.0),
        (460, 102.7),
        (500, 117.0),
        (999_999, 133.4),
    ],
    "3000": [
        (70, 93.77),
        (100, 93.77),
        (130, 93.77),
        (160, 93.77),
        (190, 96.11),
        (220, 98.5),
        (250, 100.1),
        (280, 105.0),
        (310, 109.2),
        (340, 113.6),
        (370, 118.1),
        (400, 122.9),
        (430, 127.8),
        (460, 132.9),
        (500, 138.2),
        (999_999, 143.7),
    ],
    "3500": [
        (70, 107.67),
        (100, 107.67),
        (130, 107.67),
        (160, 107.67),
        (190, 109.8),
        (220, 112.0),
        (250, 114.3),
        (280, 117.1),
        (310, 120.0),
        (340, 126.6),
        (370, 133.6),
        (400, 141.0),
        (430, 148.7),
        (460, 156.9),
        (500, 165.5),
        (999_999, 174.6),
    ],
    "3501": [
        (70, 137.116),
        (100, 137.116),
        (130, 137.116),
        (160, 137.116),
        (190, 139.46),
        (220, 141.86),
        (250, 144.26),
        (280, 147.16),
        (310, 150.6),
        (340, 155.36),
        (370, 160.736),
        (400, 166.46),
        (430, 172.26),
        (460, 178.26),
        (500, 184.46),
        (999_999, 190.96),
    ],
}

_DEFAULT_UTIL_ICE_BY_SCHEDULE: dict[str, dict[str, list[tuple[int, float]]]] = {
    "2026-01": _UTIL_ICE_STAIRS_2026_01,
    "2025-12": _UTIL_ICE_STAIRS_2025_12,
}

_UTIL_EV_STAIRS_2026_01: list[tuple[int, float]] = [
    (80, 58.7),
    (100, 68.4),
    (130, 79.7),
    (160, 92.8),
    (190, 108.1),
    (220, 126.0),
    (250, 146.8),
    (280, 171.0),
    (310, 199.2),
    (340, 199.2),
    (370, 199.2),
    (400, 199.2),
    (430, 199.2),
    (460, 199.2),
    (500, 199.2),
    (999_999, 199.2),
]

_UTIL_EV_STAIRS_2025_12: list[tuple[int, float]] = [
    (80, 33.37),
    (100, 41.3),
    (130, 54.9),
    (160, 65.0),
    (190, 77.0),
    (220, 91.4),
    (250, 108.3),
    (280, 128.3),
    (310, 152.0),
    (340, 152.0),
    (370, 152.0),
    (400, 152.0),
    (430, 152.0),
    (460, 152.0),
    (500, 152.0),
    (999_999, 152.0),
]

_DEFAULT_UTIL_EV_BY_SCHEDULE: dict[str, list[tuple[int, float]]] = {
    "2026-01": _UTIL_EV_STAIRS_2026_01,
    "2025-12": _UTIL_EV_STAIRS_2025_12,
}


def _ice_volume_band_key(engine_cc: float) -> str:
    """Ключ графика по рабочему объёму двигателя, см³ (легковые M1, ДВС)."""
    cc = float(engine_cc)
    if cc <= 1000:
        return "1000"
    if cc <= 2000:
        return "2000"
    if cc <= 3000:
        return "3000"
    if cc <= 3500:
        return "3500"
    return "3501"


def _parse_power_stairs_yaml(raw: Any) -> list[tuple[int, float]] | None:
    """Формат: [[70, 58.7], [100, 58.7], ...] — верхняя граница мощности л.с. → K."""
    if not raw or not isinstance(raw, list):
        return None
    out: list[tuple[int, float]] = []
    for row in raw:
        if isinstance(row, (list, tuple)) and len(row) >= 2:
            out.append((int(row[0]), float(row[1])))
    return out or None


def _lookup_k_from_stairs(power_hp: int, stairs: list[tuple[int, float]]) -> float:
    for hp_to, coeff in stairs:
        if power_hp <= hp_to:
            return float(coeff)
    return float(stairs[-1][1])


def _util_schedule_key(sched: str, override_root: dict[str, Any] | None, defaults: dict[str, Any]) -> str:
    s = (sched or "2026-01").strip()
    if isinstance(override_root, dict) and s in override_root:
        return s
    if s in defaults:
        return s
    return "2026-01"


def _ice_sched_table(
    o_sched: Any,
    util_under3: bool,
) -> dict[str, Any] | None:
    """Плоский {полоса: [[hp, K], ...]} или по возрасту: {under_3: {...}, from_3: {...}}."""
    if not isinstance(o_sched, dict):
        return None
    if "under_3" in o_sched and "from_3" in o_sched and isinstance(o_sched.get("under_3"), dict):
        sub = o_sched["under_3"] if util_under3 else o_sched.get("from_3")
        return sub if isinstance(sub, dict) else None
    return o_sched


def _resolve_ice_power_stairs(
    engine_cc: float,
    schedule: str,
    pp: dict[str, Any],
    *,
    util_under3: bool,
) -> list[tuple[int, float]]:
    """Таблица K(мощность) для данного объёма и расписания (с учётом YAML/JSON и опц. колонок 0–3 / 3–5 лет)."""
    override_root = pp.get("util_ice_power_stairs")
    if not isinstance(override_root, dict):
        override_root = {}
    sched = _util_schedule_key(schedule, override_root, _DEFAULT_UTIL_ICE_BY_SCHEDULE)
    band = _ice_volume_band_key(engine_cc)
    o_sched = override_root.get(sched) or override_root.get("2026-01")
    if isinstance(o_sched, dict):
        flat = _ice_sched_table(o_sched, util_under3)
        if isinstance(flat, dict):
            raw_band = flat.get(band)
            parsed = _parse_power_stairs_yaml(raw_band)
            if parsed:
                return parsed
    tbl = _DEFAULT_UTIL_ICE_BY_SCHEDULE.get(sched) or _DEFAULT_UTIL_ICE_BY_SCHEDULE["2026-01"]
    return tbl[band]


def _ev_sched_raw(o_sched: Any, util_under3: bool) -> Any:
    if isinstance(o_sched, dict) and "under_3" in o_sched and "from_3" in o_sched:
        return o_sched["under_3"] if util_under3 else o_sched.get("from_3")
    return o_sched


def _resolve_ev_power_stairs(
    schedule: str,
    pp: dict[str, Any],
    *,
    util_under3: bool,
) -> list[tuple[int, float]]:
    root = pp.get("util_ev_power_stairs")
    if not isinstance(root, dict):
        root = {}
    sched = _util_schedule_key(schedule, root, _DEFAULT_UTIL_EV_BY_SCHEDULE)
    raw = root.get(sched) or root.get("2026-01")
    raw = _ev_sched_raw(raw, util_under3)
    parsed = _parse_power_stairs_yaml(raw)
    if parsed:
        return parsed
    return _DEFAULT_UTIL_EV_BY_SCHEDULE.get(sched) or _DEFAULT_UTIL_EV_BY_SCHEDULE["2026-01"]


def _utilization_ice_table(
    power: int,
    engine_cc: float,
    pp: dict[str, Any],
    *,
    util_under3: bool,
) -> tuple[float, float, str]:
    """
    ДВС / гибрид (по объёму ДВС): УС = util_recycling_base_rub × K; K из графика объём×мощность.
    Если в JSON заданы under_3 / from_3 — колонки как в перечне (0–3 и 3–5 лет); иначе K не зависит от возраста.
    """
    base = float(pp.get("util_recycling_base_rub", 20_000))
    sched = str(pp.get("util_ice_coeff_schedule", "2026-01"))
    stairs = _resolve_ice_power_stairs(float(engine_cc), sched, pp, util_under3=util_under3)
    k = _lookup_k_from_stairs(int(power), stairs)
    age_tag = "u3" if util_under3 else "o3"
    return round(base * k), k, f"pp1291_ice_{sched}_{_ice_volume_band_key(float(engine_cc))}_{age_tag}"


def _utilization_electric_table(power: int, under3: bool, pp: dict[str, Any]) -> tuple[float, float, str]:
    """Электро / силовая установка по таблице мощности (ориентир — 30-минутная мощность кВт·с. → л.с. в форме)."""
    pref_max = int(pp.get("util_ev_preferential_hp_max", 80))
    if int(power) <= pref_max:
        u_u3 = float(pp.get("util_under_3_le_hp", 3400))
        u_o3 = float(pp.get("util_over_3_le_hp", 5200))
        fee = u_u3 if under3 else u_o3
        return float(fee), 0.0, "flat_ev_le_pref_hp"

    base = float(pp.get("util_recycling_base_rub", 20_000))
    sched_e = str(pp.get("util_electric_coeff_schedule") or pp.get("util_ice_coeff_schedule", "2026-01"))
    stairs = _resolve_ev_power_stairs(sched_e, pp, util_under3=under3)
    k = _lookup_k_from_stairs(int(power), stairs)
    age_tag = "u3" if under3 else "o3"
    return round(base * k), k, f"pp1291_ev_{sched_e}_{age_tag}"


def _clearance_from_tiers(customs_value_rub: float, tiers: list[tuple[float, float]] | None) -> float:
    t = tiers if tiers else _DEFAULT_CLEARANCE_TIERS_RUB
    for limit_rub, fee_rub in t:
        if customs_value_rub <= limit_rub:
            return float(fee_rub)
    return float(t[-1][1])


def clearance_fee_rub(customs_value_rub: float, tariffs: dict[str, Any]) -> float:
    """Сбор за оформление по ступеням (ПП № 1637 или physical_person.clearance_tiers в YAML)."""
    return _clearance_from_tiers(customs_value_rub, parse_clearance_tiers(tariffs))


def price_rub_from_daily(daily: CbrDailyRates, price: float, currency: str) -> float:
    c = (currency or "RUB").upper().strip()
    if c == "RUB":
        return float(price)
    rpu = daily.rub_per_unit.get(c)
    if rpu is None:
        raise ValueError(f"В котировках ЦБ нет валюты {c} для пересчёта таможенной стоимости.")
    return float(price) * float(rpu)


def eur_to_rub(daily: CbrDailyRates) -> float:
    e = daily.rub_per_unit.get("EUR")
    if e is None:
        raise ValueError("В котировках ЦБ нет курса EUR.")
    return float(e)


def parse_clearance_tiers(tariffs: dict[str, Any]) -> list[tuple[float, float]] | None:
    """Опционально: physical_person.clearance_tiers: [[200000, 1067], ...]"""
    pp = tariffs.get("physical_person") or {}
    raw = pp.get("clearance_tiers")
    if not raw or not isinstance(raw, list):
        return None
    out: list[tuple[float, float]] = []
    for row in raw:
        if isinstance(row, (list, tuple)) and len(row) >= 2:
            out.append((float(row[0]), float(row[1])))
    return out or None


def _parse_under3_eur_brackets(pp: dict[str, Any]) -> list[tuple[float, float, float]]:
    raw = pp.get("duty_under_3_eur_brackets")
    if not raw or not isinstance(raw, list):
        return list(_DEFAULT_DUTY_UNDER3_EUR_BRACKETS)
    rows: list[tuple[float, float, float]] = []
    for b in raw:
        if isinstance(b, dict) and "max_eur" in b:
            rows.append((float(b["max_eur"]), float(b["percent"]), float(b["min_eur_per_cc"])))
    return rows or list(_DEFAULT_DUTY_UNDER3_EUR_BRACKETS)


def _eur_per_cc_for_age_band(
    engine_cc: float,
    age: str,
    pp: dict[str, Any],
) -> tuple[float, list[tuple[float, float]]]:
    """Ставка €/см³ по объёму для физлица (ЕТТ), возраст 3–5 / 5–7 / старше 7 лет."""
    if age == "3-5":
        key = "duty_eur_per_cc_bands_3_5"
        default = _DEFAULT_EUR_CC_3_5
    elif age == "5-7":
        key = "duty_eur_per_cc_bands_5_7"
        default = _DEFAULT_EUR_CC_5_7
    elif age == "over_7":
        key = "duty_eur_per_cc_bands_over_7"
        default = _DEFAULT_EUR_CC_OVER_7
    else:
        return 2.7, _DEFAULT_EUR_CC_3_5

    tiers = pp.get(key)
    if not tiers or not isinstance(tiers, list):
        tiers_list = default
    else:
        tiers_list = []
        for row in tiers:
            if isinstance(row, (list, tuple)) and len(row) >= 2:
                tiers_list.append((float(row[0]), float(row[1])))
        if not tiers_list:
            tiers_list = default

    for limit_cc, eur in tiers_list:
        if engine_cc <= limit_cc:
            return float(eur), tiers_list
    return float(tiers_list[-1][1]), tiers_list


def duty_physical_person(
    age: str,
    engine_type: str,
    engine_cc: float,
    customs_value_rub: float,
    eur_rub: float,
    pp: dict[str, Any],
    power_hp: int = 0,
) -> tuple[float, str, dict[str, Any]]:
    """
    Пошлина физлица по ЕТТ ЕАЭС (таблицы как на drom.ru §3 для легковых).
    До 3 лет: max(%×тамож.стоимость в ₽, min_€/см³×см³×курс) по ступеням тамож. стоимости в EUR.
    Старше: €/см³ × объём × курс (ступени по см³ зависят от возраста).
    """
    extra: dict[str, Any] = {"customs_value_eur": None, "duty_percent_applied": None, "duty_min_eur_per_cc": None}
    customs_eur = float(customs_value_rub) / float(eur_rub) if eur_rub else 0.0
    extra["customs_value_eur"] = round(customs_eur, 2)

    if engine_type == "electric":
        if age in ("new", "1-3"):
            pct = float(pp.get("duty_electric_percent_under_3", 15.0)) / 100.0
            extra["duty_percent_applied"] = pct * 100.0
            return float(customs_value_rub) * pct, "electric_percent_under_3", extra
        eur_kw = float(pp.get("duty_electric_eur_per_kw_over_3", 0.0))
        if eur_kw > 0 and power_hp > 0:
            kw = float(power_hp) * 0.73549875
            duty = kw * eur_kw * float(eur_rub)
            extra["duty_kw"] = round(kw, 2)
            return round(duty, 2), "electric_eur_per_kw", extra
        return 0.0, "electric_duty_unconfigured", extra

    if age in ("new", "1-3"):
        for max_eur, pct, min_eur_cc in _parse_under3_eur_brackets(pp):
            if customs_eur < max_eur:
                by_pct = float(customs_value_rub) * (pct / 100.0)
                by_cc = min_eur_cc * float(engine_cc) * float(eur_rub)
                extra["duty_percent_applied"] = pct
                extra["duty_min_eur_per_cc"] = min_eur_cc
                duty = max(by_pct, by_cc)
                return round(duty, 2), "percent_under_3_ett", extra
        return 0.0, "unknown", extra

    if age == "3-5":
        eur_cc, _ = _eur_per_cc_for_age_band(engine_cc, "3-5", pp)
        duty = eur_cc * float(engine_cc) * float(eur_rub)
        extra["rate_per_cc_eur"] = eur_cc
        return round(duty, 2), "eur_per_cc_3_5", extra

    if age == "5-7":
        eur_cc, _ = _eur_per_cc_for_age_band(engine_cc, "5-7", pp)
        duty = eur_cc * float(engine_cc) * float(eur_rub)
        extra["rate_per_cc_eur"] = eur_cc
        return round(duty, 2), "eur_per_cc_5_7", extra

    if age == "over_7":
        eur_cc, _ = _eur_per_cc_for_age_band(engine_cc, "over_7", pp)
        duty = eur_cc * float(engine_cc) * float(eur_rub)
        extra["rate_per_cc_eur"] = eur_cc
        return round(duty, 2), "eur_per_cc_over_7", extra

    return 0.0, "unknown", extra


def utilization_physical(
    age: str,
    power: int,
    engine_cc: float,
    engine_type: str,
    pp: dict[str, Any],
) -> tuple[float, str, float | None]:
    """
    Утилизационный сбор (ПП РФ № 1291):
    - физлица, ДВС до порога мощности (по умолчанию 160 л.с.): фикс. 3400 / 5200 ₽ (до 3 лет / старше);
    - электро до util_ev_preferential_hp_max (по умолчанию 80 л.с.): те же льготные суммы;
    - иначе: УС = util_recycling_base_rub × K, K — из таблицы по объёму и мощности (ДВС) или по мощности (электро).
    """
    hp_th = int(pp.get("util_hp_threshold", 160))
    u_u3 = float(pp.get("util_under_3_le_hp", 3400))
    u_o3 = float(pp.get("util_over_3_le_hp", 5200))

    under3 = age in ("new", "1-3")

    if engine_type == "electric":
        fee, k_val, mode = _utilization_electric_table(power, under3, pp)
        k_out = None if mode == "flat_ev_le_pref_hp" else k_val
        return fee, mode, k_out

    if power <= hp_th:
        fee = u_u3 if under3 else u_o3
        return fee, "flat_le_hp", None

    fee, k_val, mode = _utilization_ice_table(
        power, float(engine_cc), pp, util_under3=under3
    )
    return fee, mode, k_val


def compute_etc_individual(
    *,
    age: str,
    engine_type: str,
    engine_capacity: int,
    power: int,
    price: float,
    currency: str,
    daily: CbrDailyRates,
    tariffs: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    pp = (tariffs.get("physical_person") or {}) if isinstance(tariffs.get("physical_person"), dict) else {}

    customs_rub = price_rub_from_daily(daily, price, currency)
    eur_rub = eur_to_rub(daily)
    clearance = _clearance_from_tiers(customs_rub, parse_clearance_tiers(tariffs))
    duty, mode, duty_extra = duty_physical_person(
        age, engine_type, float(engine_capacity), customs_rub, eur_rub, pp, power_hp=power
    )
    util, util_mode, util_k = utilization_physical(age, power, float(engine_capacity), engine_type, pp)

    total = clearance + duty + util

    meta = {
        "duty_mode": mode,
        "customs_value_rub": customs_rub,
        "customs_value_eur": duty_extra.get("customs_value_eur"),
        "duty_percent": duty_extra.get("duty_percent_applied"),
        "duty_min_eur_per_cc": duty_extra.get("duty_min_eur_per_cc"),
        "rate_per_cc_eur": duty_extra.get("rate_per_cc_eur"),
        "utilization_mode": util_mode,
        "util_coefficient": util_k,
        "util_ice_coeff_schedule": str(pp.get("util_ice_coeff_schedule", "2026-01")),
    }

    out = {
        "Mode": "ETC",
        "Customs value (RUB)": round(customs_rub, 2),
        "Clearance Fee (RUB)": clearance,
        "Duty (RUB)": round(duty, 2),
        "Utilization Fee (RUB)": util,
        "Total Pay (RUB)": round(total, 2),
    }
    return out, meta


def _stairs_to_jsonable(stairs: list[tuple[int, float]]) -> list[list[float | int]]:
    return [[int(a), float(b)] for a, b in stairs]


def export_util_tables_as_dict(*, individual: bool) -> dict[str, Any]:
    """Сериализация встроенных таблиц для админки / JSON по умолчанию."""
    ice_out: dict[str, Any] = {}
    for sched, tbl in _DEFAULT_UTIL_ICE_BY_SCHEDULE.items():
        ice_out[sched] = {band: _stairs_to_jsonable(rows) for band, rows in tbl.items()}
    ev_out: dict[str, Any] = {}
    for sched, rows in _DEFAULT_UTIL_EV_BY_SCHEDULE.items():
        ev_out[sched] = _stairs_to_jsonable(rows)
    out: dict[str, Any] = {
        "version": 1,
        "description": (
            "Физлица: льготные фиксированные суммы до util_hp_threshold (ДВС) и util_ev_preferential_hp_max (электро)."
            if individual
            else "Юрлица: УС = util_recycling_base_rub × K по таблицам, без льгот 3400/5200 и без порога 80 л.с. для электро."
        ),
        "util_ice_coeff_schedule": "2026-01",
        "util_recycling_base_rub": 20_000,
        "util_ice_power_stairs": ice_out,
        "util_ev_power_stairs": ev_out,
    }
    if individual:
        out["util_hp_threshold"] = 160
        out["util_under_3_le_hp"] = 3400
        out["util_over_3_le_hp"] = 5200
        out["util_ev_preferential_hp_max"] = 80
    else:
        out["util_electric_coeff_schedule"] = "2026-01"
    return out


def utilization_company_fee(
    power: int,
    engine_cc: float,
    engine_type: str,
    pp: dict[str, Any],
    *,
    age: str | None = None,
) -> tuple[float, float, str]:
    """
    Утилизационный сбор для юрлица (CTP): только база × K по таблицам из конфига, без льгот физлиц.
    Если в JSON есть under_3 / from_3, возраст выбирает колонку (new/1-3 → under_3, иначе → from_3).
    """
    util_u3 = age in ("new", "1-3") if age else True
    pp2 = dict(pp)
    pp2["util_hp_threshold"] = 0
    pp2["util_ev_preferential_hp_max"] = 0
    age_tag = "u3" if util_u3 else "o3"
    if engine_type == "electric":
        base = float(pp2.get("util_recycling_base_rub", 20_000))
        sched_e = str(pp2.get("util_electric_coeff_schedule") or pp2.get("util_ice_coeff_schedule", "2026-01"))
        stairs = _resolve_ev_power_stairs(sched_e, pp2, util_under3=util_u3)
        k = _lookup_k_from_stairs(int(power), stairs)
        return round(base * k), k, f"company_ev_{sched_e}_{age_tag}"
    base = float(pp2.get("util_recycling_base_rub", 20_000))
    sched = str(pp2.get("util_ice_coeff_schedule", "2026-01"))
    stairs = _resolve_ice_power_stairs(float(engine_cc), sched, pp2, util_under3=util_u3)
    k = _lookup_k_from_stairs(int(power), stairs)
    return round(base * k), k, f"company_ice_{sched}_{_ice_volume_band_key(float(engine_cc))}_{age_tag}"
