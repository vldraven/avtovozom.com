from __future__ import annotations

import json
from copy import deepcopy
from typing import Any

DEFAULT_ADDITIONAL_EXPENSES: dict[str, Any] = {
    "export_expenses": {
        "amount": 150000,
        "currency": "CNY",
        "description": (
            "Сбор автосалона/партнера, транспортировка по стране экспорта, "
            "экспортные документы и снятие с учета при необходимости."
        ),
    },
    "russia_expenses": {
        "amount": 100000,
        "currency": "RUB",
        "description": "Логистика по РФ, подготовка и передача автомобиля покупателю.",
    },
    "bank_commission": {
        "percent": 2.5,
        "description": "Комиссия банка за международный перевод от стоимости автомобиля.",
    },
    "company_commission": {
        "amount": 100000,
        "currency": "RUB",
        "description": "Комиссия компании за сопровождение сделки и организацию поставки.",
    },
}


def default_additional_expenses_json() -> str:
    return json.dumps(DEFAULT_ADDITIONAL_EXPENSES, ensure_ascii=False, indent=2)


def parse_additional_expenses_json(raw: str | None) -> dict[str, Any]:
    cfg = deepcopy(DEFAULT_ADDITIONAL_EXPENSES)
    if not raw or not str(raw).strip():
        return cfg
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return cfg
    if not isinstance(parsed, dict):
        return cfg

    exp = parsed.get("export_expenses")
    if isinstance(exp, dict):
        cfg["export_expenses"]["amount"] = _safe_float(exp.get("amount"), cfg["export_expenses"]["amount"])
        cfg["export_expenses"]["currency"] = _safe_currency(exp.get("currency"), cfg["export_expenses"]["currency"])
        cfg["export_expenses"]["description"] = _safe_text(exp.get("description"), cfg["export_expenses"]["description"])

    rus = parsed.get("russia_expenses")
    if isinstance(rus, dict):
        cfg["russia_expenses"]["amount"] = _safe_float(rus.get("amount"), cfg["russia_expenses"]["amount"])
        cfg["russia_expenses"]["currency"] = _safe_currency(rus.get("currency"), cfg["russia_expenses"]["currency"])
        cfg["russia_expenses"]["description"] = _safe_text(rus.get("description"), cfg["russia_expenses"]["description"])

    bank = parsed.get("bank_commission")
    if isinstance(bank, dict):
        cfg["bank_commission"]["percent"] = _safe_float(bank.get("percent"), cfg["bank_commission"]["percent"])
        cfg["bank_commission"]["description"] = _safe_text(bank.get("description"), cfg["bank_commission"]["description"])

    company = parsed.get("company_commission")
    if isinstance(company, dict):
        cfg["company_commission"]["amount"] = _safe_float(company.get("amount"), cfg["company_commission"]["amount"])
        cfg["company_commission"]["currency"] = _safe_currency(company.get("currency"), cfg["company_commission"]["currency"])
        cfg["company_commission"]["description"] = _safe_text(company.get("description"), cfg["company_commission"]["description"])

    return cfg


def validate_additional_expenses_json(raw: str | None) -> str | None:
    if raw is None or not str(raw).strip():
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        return f"Дополнительные расходы: невалидный JSON ({e})"
    if not isinstance(parsed, dict):
        return "Дополнительные расходы: ожидается JSON-объект."
    return None


def _safe_float(value: Any, fallback: float) -> float:
    try:
        num = float(value)
    except (TypeError, ValueError):
        return float(fallback)
    return max(0.0, num)


def _safe_currency(value: Any, fallback: str) -> str:
    cur = str(value or "").strip().upper()
    if cur in {"RUB", "CNY"}:
        return cur
    return fallback


def _safe_text(value: Any, fallback: str) -> str:
    text = str(value or "").strip()
    return text if text else fallback
