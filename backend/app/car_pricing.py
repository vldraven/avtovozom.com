"""Цена в Китае в ₽ по курсу ЦБ и подсказки для расчёта таможни без платных API."""

from __future__ import annotations

from .cbr_rates import get_cny_rub_rate
from .body_colors import label_for_slug
from .models import Car
from .schemas import CarPricingGuideOut, CbrSnapshot, FreeCalculatorLink


def build_cbr_snapshot() -> tuple[CbrSnapshot | None, str | None]:
    cbr, err = get_cny_rub_rate()
    if cbr is None:
        return None, err
    return CbrSnapshot(rub_per_cny=cbr.rub_per_one_cny, rate_date=cbr.rate_date), None


def rub_china_for_car(car: Car, snap: CbrSnapshot) -> float:
    return round(float(car.price_cny) * snap.rub_per_cny, 2)


def _calculator_links() -> list[FreeCalculatorLink]:
    """Один бесплатный справочный калькулятор (без API-ключей)."""
    return [
        FreeCalculatorLink(
            title="Калькулятор растаможки автомобилей (ТКС)",
            url="https://www.tks.ru/auto/calc/",
            description="Онлайн-расчёт пошлин и сборов для ввозимых автомобилей.",
        ),
    ]


def build_pricing_guide(car: Car, snap: CbrSnapshot) -> CarPricingGuideOut:
    rub = rub_china_for_car(car, snap)
    reg = (car.registration_date or "").strip() or "не указана"
    prod = (car.production_date or "").strip() or "не указана"
    fuel = (car.fuel_type or "").strip() or "не указано"
    color_lbl = label_for_slug(getattr(car, "body_color_slug", None))
    params_lines = [
        f"Стоимость в объявлении: {float(car.price_cny):,.0f} CNY".replace(",", " "),
        f"Ориентир в рублях по курсу ЦБ на {snap.rate_date}: ~{rub:,.0f} RUB".replace(",", " "),
        f"Год выпуска (модельный): {car.year}",
        f"Дата регистрации в объявлении: {reg}",
        f"Дата производства в объявлении: {prod}",
        f"Объём двигателя: {car.engine_volume_cc} см³",
        f"Мощность: {car.horsepower} л.с.",
        f"Тип топлива / силовая установка: {fuel}",
    ]
    if color_lbl:
        params_lines.append(f"Цвет кузова: {color_lbl}")
    params_lines.append(
        "Для калькуляторов обычно нужны: возраст авто, объём, мощность, тип двигателя, стоимость в валюте и сценарий (личное использование / коммерция)."
    )
    return CarPricingGuideOut(
        cbr_rub_per_cny=snap.rub_per_cny,
        cbr_date=snap.rate_date,
        rub_china=rub,
        params_lines=params_lines,
        calculator_links=_calculator_links(),
        disclaimer=(
            "Сайт не выполняет автоматический расчёт таможенных платежей: ставки и правила меняются, "
            "нужны актуальные первичные данные и выбор сценария ввоза. Используйте бесплатные калькуляторы "
            "и при необходимости консультацию брокера."
        ),
    )
