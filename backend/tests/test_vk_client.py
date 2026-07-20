"""Unit tests for VK client helpers (no live VK calls)."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from app.vk_client import VkApiError, VkConfig, wall_post
from app.vk_publish import build_default_vk_post_text
from app.listing_compose import ListingMarketingCompose


class VkClientTests(unittest.TestCase):
    def test_wall_post_builds_url(self):
        cfg = VkConfig(group_id=111, user_access_token="tok", api_version="5.199")
        with patch("app.vk_client._api_call", return_value={"post_id": 42}) as mock_call:
            result = wall_post(cfg, message="Hello", attachments=["photo-111_1"])
        self.assertEqual(result.post_id, 42)
        self.assertEqual(result.owner_id, -111)
        self.assertEqual(result.wall_url, "https://vk.com/wall-111_42")
        args, kwargs = mock_call.call_args
        self.assertEqual(args[0], "wall.post")
        self.assertEqual(args[1]["from_group"], 1)
        self.assertEqual(args[1]["owner_id"], -111)

    def test_wall_post_requires_content(self):
        cfg = VkConfig(group_id=1, user_access_token="t")
        with self.assertRaises(VkApiError):
            wall_post(cfg, message="  ", attachments=[])

    def test_default_text_includes_title_and_url(self):
        compose = ListingMarketingCompose(
            car_id=1,
            title="BMW 3 Series 2022 320Li M",
            brand="BMW",
            model="3 Series",
            generation="G20",
            year=2022,
            mileage_km=50000,
            engine_volume_cc=2000,
            horsepower=156,
            fuel_type="бензин",
            transmission="AT",
            location_city=None,
            price_cny=100000,
            description="",
            rub_china=1200000,
            estimated_total_rub=2500000,
            canonical_path="/catalog/bmw/3-series/1",
            canonical_web_url="https://avtovozom.com/catalog/bmw/3-series/1",
            photos=[],
        )
        text = build_default_vk_post_text(compose)
        self.assertIn("BMW 3 Series 2022 320Li M", text)
        self.assertIn("https://avtovozom.com/catalog/bmw/3-series/1", text)
        self.assertIn("2 500 000", text)


if __name__ == "__main__":
    unittest.main()
