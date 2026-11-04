"""Promo campaigns: date window, exclusive enable, public payload shape."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

from app.promo import (
    _campaign_in_window,
    _disable_other_campaigns,
    _is_active,
    _public_active_payload,
    get_active_campaign,
)
from app.models import PromoCampaign, PromoPlacement


def _camp(**kwargs) -> PromoCampaign:
    now = datetime.utcnow()
    defaults = dict(
        id=1,
        slug="test",
        name="Test",
        is_enabled=True,
        starts_at=now - timedelta(days=1),
        ends_at=now + timedelta(days=1),
        promo_code="tg-30",
        accent_color="#d9f43a",
        eyebrow="Для подписчиков Telegram",
        title_accent="−30%",
        title_rest="на наши услуги\nдо 30 ноября",
        subtitle="Скидка",
        cta_label="Оставить заявку",
        cta_path="/request-quote",
        hero_image_url="/promo/hero-zeekr007-full.png",
        placements=[],
    )
    defaults.update(kwargs)
    c = PromoCampaign()
    for k, v in defaults.items():
        setattr(c, k, v)
    return c


class PromoWindowTests(unittest.TestCase):
    def test_in_window(self):
        now = datetime(2026, 11, 15, 12, 0, 0)
        camp = _camp(
            starts_at=datetime(2026, 10, 31, 21, 0, 0),
            ends_at=datetime(2026, 11, 30, 20, 59, 59),
        )
        self.assertTrue(_campaign_in_window(camp, now))
        self.assertTrue(_is_active(camp, now))

    def test_outside_window(self):
        now = datetime(2026, 12, 1, 0, 0, 0)
        camp = _camp(
            starts_at=datetime(2026, 10, 31, 21, 0, 0),
            ends_at=datetime(2026, 11, 30, 20, 59, 59),
        )
        self.assertFalse(_campaign_in_window(camp, now))
        self.assertFalse(_is_active(camp, now))

    def test_disabled_not_active(self):
        now = datetime(2026, 11, 15, 12, 0, 0)
        camp = _camp(is_enabled=False)
        self.assertFalse(_is_active(camp, now))


class PromoExclusiveEnableTests(unittest.TestCase):
    def test_disable_other_campaigns(self):
        db = MagicMock()
        _disable_other_campaigns(db, keep_id=42)
        db.execute.assert_called_once()


class PromoPublicPayloadTests(unittest.TestCase):
    def test_public_payload_only_enabled_placements(self):
        camp = _camp(
            placements=[
                PromoPlacement(
                    id=1,
                    campaign_id=1,
                    placement="home_hero",
                    is_enabled=True,
                    image_url="/promo/hero.png",
                ),
                PromoPlacement(
                    id=2,
                    campaign_id=1,
                    placement="catalog_sidebar",
                    is_enabled=False,
                    image_url="/promo/vw.png",
                ),
            ]
        )
        payload = _public_active_payload(camp)
        keys = payload.get("placement_keys") or []
        self.assertIn("home_hero", keys)
        self.assertNotIn("catalog_sidebar", keys)
        self.assertEqual(payload["promo_code"], "tg-30")


class PromoGetActiveTests(unittest.TestCase):
    def test_get_active_picks_enabled_in_window(self):
        now = datetime(2026, 11, 15, 12, 0, 0)
        older = _camp(id=1, slug="old", is_enabled=True)
        newer = _camp(id=2, slug="new", is_enabled=True)
        db = MagicMock()
        # emulate ensure_promo_seed no-op path + query result
        result = MagicMock()
        result.unique.return_value.scalars.return_value.all.return_value = [newer, older]
        db.execute.return_value = result
        with patch("app.promo.ensure_promo_seed"):
            active = get_active_campaign(db, now=now)
        self.assertIs(active, newer)


if __name__ == "__main__":
    unittest.main()
