"""Unit tests for VK client helpers (no live VK calls)."""

from __future__ import annotations

import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from app.vk_client import (
    VkApiError,
    VkConfig,
    _local_media_path_from_url,
    _write_jpeg_temp,
    wall_post,
)
from app.vk_publish import build_default_vk_post_text
from app.listing_compose import ListingMarketingCompose


class VkClientTests(unittest.TestCase):
    def test_wall_post_builds_url(self):
        cfg = VkConfig(group_id=111, group_access_token="group-tok", api_version="5.199")
        with patch("app.vk_client._api_call", return_value={"post_id": 42}) as mock_call:
            result = wall_post(cfg, message="Hello", attachments=["photo-111_1"])
        self.assertEqual(result.post_id, 42)
        self.assertEqual(result.owner_id, -111)
        self.assertEqual(result.wall_url, "https://vk.com/wall-111_42")
        args, kwargs = mock_call.call_args
        self.assertEqual(args[0], "wall.post")
        self.assertEqual(args[1]["from_group"], 1)
        self.assertEqual(args[1]["owner_id"], -111)
        self.assertEqual(kwargs["token"], "group-tok")

    def test_wall_post_requires_content(self):
        cfg = VkConfig(group_id=1, group_access_token="t")
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

    def test_write_jpeg_temp_rejects_html(self):
        with self.assertRaises(VkApiError) as ctx:
            _write_jpeg_temp(b"<!DOCTYPE html><html><body>404</body></html>")
        self.assertIn("HTML", str(ctx.exception))

    def test_write_jpeg_temp_reencodes_png(self):
        buf = io.BytesIO()
        Image.new("RGB", (32, 24), color=(10, 20, 30)).save(buf, format="PNG")
        out = _write_jpeg_temp(buf.getvalue())
        try:
            self.assertTrue(out.is_file())
            self.assertEqual(out.suffix, ".jpg")
            with Image.open(out) as im:
                self.assertEqual(im.format, "JPEG")
                self.assertEqual(im.size, (32, 24))
        finally:
            out.unlink(missing_ok=True)

    def test_local_media_path_from_url(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rel = root / "cars" / "1" / "0.jpg"
            rel.parent.mkdir(parents=True)
            rel.write_bytes(b"x")
            with patch("app.media_storage.media_root", return_value=root):
                self.assertEqual(
                    _local_media_path_from_url("https://api.avtovozom.com/media/cars/1/0.jpg"),
                    rel,
                )
                self.assertIsNone(_local_media_path_from_url("https://cdn.example/a.jpg"))


if __name__ == "__main__":
    unittest.main()
