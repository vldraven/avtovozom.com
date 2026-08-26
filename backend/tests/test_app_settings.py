"""Tests for app_settings VK token helpers (no DB)."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

from app.app_settings import mask_token, set_vk_user_token, vk_oauth_authorize_url


class AppSettingsVkTokenTests(unittest.TestCase):
    def test_mask_token(self):
        self.assertEqual(mask_token(""), "")
        self.assertIn("…", mask_token("vk1.a." + "x" * 40))

    def test_oauth_url(self):
        url = vk_oauth_authorize_url()
        self.assertIn("oauth.vk.com/authorize", url)
        self.assertIn("scope=photos", url)

    def test_set_token_parses_redirect_url(self):
        db = MagicMock()
        with patch("app.app_settings.set_setting") as set_setting, patch(
            "app.app_settings.get_setting", return_value=""
        ):
            # avoid real commit path complexity — call internals via set_vk_user_token
            def _set(db_arg, key, value):
                pass

            set_setting.side_effect = _set
            db.commit = MagicMock()
            url = (
                "https://oauth.vk.ru/blank.html#access_token=vk1.a.TESTTOKEN1234567890"
                "&expires_in=86400&user_id=1"
            )
            with patch("app.app_settings.set_setting") as ss:
                stored = {}

                def capture(_db, key, value):
                    stored[key] = value

                ss.side_effect = capture
                exp = set_vk_user_token(db, url, expires_in=None)
                self.assertEqual(stored.get("vk_user_access_token"), "vk1.a.TESTTOKEN1234567890")
                self.assertIsNotNone(exp)
                self.assertGreater(exp, datetime.utcnow() + timedelta(hours=20))


if __name__ == "__main__":
    unittest.main()
