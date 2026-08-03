"""Tests for market research helpers and collect schemas."""

from __future__ import annotations

import unittest
from datetime import date, timedelta

from app.agent_api import market_research_for_profile
from app.models import SearchProfile


class _P:
    def __init__(self, criteria: dict):
        self.id = 14
        self.criteria = criteria


class MarketResearchTests(unittest.TestCase):
    def test_stale_when_missing(self) -> None:
        out = market_research_for_profile(_P({}), max_age_days=7)
        self.assertTrue(out.stale)
        self.assertEqual(out.market_hot_models, [])

    def test_fresh_within_week(self) -> None:
        today = date.today().isoformat()
        out = market_research_for_profile(
            _P(
                {
                    "market_research_at": today,
                    "market_hot_models": ["Haval Jolion", "Geely Coolray"],
                }
            ),
            max_age_days=7,
        )
        self.assertFalse(out.stale)
        self.assertEqual(out.market_hot_models[0], "Haval Jolion")

    def test_stale_after_week(self) -> None:
        old = (date.today() - timedelta(days=8)).isoformat()
        out = market_research_for_profile(
            _P({"market_research_at": old, "market_hot_models": ["x"]}),
            max_age_days=7,
        )
        self.assertTrue(out.stale)


if __name__ == "__main__":
    unittest.main()
