"""Unit tests for MAX client helpers (no live API calls)."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from app.max_client import (
    MaxApiError,
    MaxConfig,
    _link_keyboard_attachment,
    _parse_message_id,
    load_max_config_from_env,
    mask_chat_id,
    publish_listing_to_channel,
    send_channel_message,
)
from app.max_publish import build_default_max_post_text
from app.listing_compose import ListingMarketingCompose


class MaxClientTests(unittest.TestCase):
    def test_load_config_from_env(self):
        with patch.dict(
            "os.environ",
            {
                "MAX_BOT_TOKEN": "tok123",
                "MAX_CHANNEL_CHAT_ID": '"987654321"',
            },
            clear=False,
        ):
            cfg = load_max_config_from_env()
        self.assertIsNotNone(cfg)
        assert cfg is not None
        self.assertEqual(cfg.bot_token, "tok123")
        self.assertEqual(cfg.channel_chat_id, 987654321)

    def test_load_config_missing(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertIsNone(load_max_config_from_env())

    def test_mask_chat_id(self):
        self.assertEqual(mask_chat_id(123456789), "***6789")

    def test_link_keyboard_attachment(self):
        att = _link_keyboard_attachment("https://avtovozom.com/car/1")
        self.assertEqual(att["type"], "inline_keyboard")
        btn = att["payload"]["buttons"][0][0]
        self.assertEqual(btn["url"], "https://avtovozom.com/car/1")

    def test_parse_message_id_from_body(self):
        msg = {"body": {"mid": "42"}, "timestamp": 1000}
        self.assertEqual(_parse_message_id(msg), 42)

    def test_send_channel_message_success(self):
        cfg = MaxConfig(bot_token="tok", channel_chat_id=1)
        response = {
            "message": {
                "url": "https://max.ru/channel/post/1",
                "body": {"mid": 99},
            }
        }
        with patch("app.max_client._api_request", return_value=response) as mock_api:
            result = send_channel_message(
                cfg,
                text="Hello",
                image_urls=["https://cdn.example/a.jpg"],
                listing_web_url="https://avtovozom.com/x",
            )
        self.assertEqual(result.post_url, "https://max.ru/channel/post/1")
        self.assertEqual(result.message_id, 99)
        args, kwargs = mock_api.call_args
        self.assertEqual(args[1], "POST")
        self.assertEqual(args[2], "/messages")
        body = kwargs["json_body"]
        self.assertEqual(body["text"], "Hello")
        self.assertTrue(body["notify"])
        types = [a["type"] for a in body["attachments"]]
        self.assertIn("image", types)
        self.assertIn("inline_keyboard", types)

    def test_publish_listing_not_configured(self):
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(MaxApiError):
                publish_listing_to_channel(message="x", photo_urls=[])

    def test_default_text_matches_vk_skeleton(self):
        compose = ListingMarketingCompose(
            car_id=1,
            title="BMW 3 Series",
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
        text = build_default_max_post_text(compose)
        self.assertIn("BMW 3 Series", text)
        self.assertIn("https://avtovozom.com/catalog/bmw/3-series/1", text)


if __name__ == "__main__":
    unittest.main()
