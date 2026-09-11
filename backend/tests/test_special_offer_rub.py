"""Tests for special_offer_rub parsing and effective turnkey price."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.main import _display_turnkey_rub, _optional_special_offer_rub


class _Car:
    def __init__(self, special_offer_rub=None):
        self.special_offer_rub = special_offer_rub


def test_optional_special_offer_empty_clears():
    assert _optional_special_offer_rub(None) is None
    assert _optional_special_offer_rub("") is None
    assert _optional_special_offer_rub("  ") is None


def test_optional_special_offer_parses():
    assert _optional_special_offer_rub("2 150 000") == 2150000.0
    assert _optional_special_offer_rub("2150000,5") == 2150000.5


def test_optional_special_offer_rejects_invalid():
    with pytest.raises(HTTPException):
        _optional_special_offer_rub("abc")
    assert _optional_special_offer_rub("0") is None
    assert _optional_special_offer_rub("-1") is None


def test_display_turnkey_prefers_offer():
    assert _display_turnkey_rub(_Car(1_900_000), 2_100_000) == 1_900_000.0
    assert _display_turnkey_rub(_Car(None), 2_100_000) == 2_100_000.0
    assert _display_turnkey_rub(_Car(0), 2_100_000) == 2_100_000.0
    assert _display_turnkey_rub(_Car(None), None) is None
