"""Парсинг курса продажи CNY из ответа API ВТБ."""

from __future__ import annotations

import unittest

from app.vtb_rates import parse_vtb_cny_sell_offer


class VtbCnySellRateParseTests(unittest.TestCase):
    def test_picks_subscription_tier_offer(self):
        payload = {
            "dateFrom": "2026-08-11T09:20:00.194",
            "rates": [
                {
                    "currency1": {"code": "CNY"},
                    "currency2": {"code": "RUB"},
                    "scale": 1,
                    "bid": 12.0875,
                    "offer": 12.328,
                    "tooltip": "до 100.00",
                },
                {
                    "currency1": {"code": "CNY"},
                    "currency2": {"code": "RUB"},
                    "scale": 1,
                    "bid": 12.1125,
                    "offer": 12.303,
                    "tooltip": "до 5000000.00",
                },
                {
                    "currency1": {"code": "USD"},
                    "currency2": {"code": "RUB"},
                    "scale": 1,
                    "bid": 80.0,
                    "offer": 82.0,
                    "tooltip": "до 5000000.00",
                },
            ],
        }
        parsed = parse_vtb_cny_sell_offer(payload)
        self.assertAlmostEqual(parsed.rub_per_one_cny, 12.303)
        self.assertEqual(parsed.rate_date, "11.08.2026")

    def test_divides_by_scale(self):
        payload = {
            "dateFrom": "2026-08-10T18:25:00",
            "rates": [
                {
                    "currency1": {"code": "CNY"},
                    "currency2": {"code": "RUB"},
                    "scale": 10,
                    "bid": 120.0,
                    "offer": 123.03,
                    "tooltip": "до 5000000.00",
                }
            ],
        }
        parsed = parse_vtb_cny_sell_offer(payload)
        self.assertAlmostEqual(parsed.rub_per_one_cny, 12.303)

    def test_missing_tier_raises(self):
        payload = {
            "dateFrom": "2026-08-11T09:20:00",
            "rates": [
                {
                    "currency1": {"code": "CNY"},
                    "currency2": {"code": "RUB"},
                    "scale": 1,
                    "offer": 12.3,
                    "tooltip": "до 100.00",
                }
            ],
        }
        with self.assertRaises(ValueError):
            parse_vtb_cny_sell_offer(payload)


if __name__ == "__main__":
    unittest.main()
