"""Tests for server-side VK OAuth helpers."""

from __future__ import annotations

import json
import unittest
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

from app.vk_oauth import (
    begin_vk_oauth,
    complete_vk_oauth,
    safe_return_to,
    vk_oauth_mode,
    vk_oauth_redirect_uri,
)


class VkOAuthHelpersTests(unittest.TestCase):
    def test_safe_return_to(self):
        self.assertEqual(safe_return_to("/staff/publish-social/12"), "/staff/publish-social/12")
        self.assertEqual(safe_return_to("https://evil.com"), "/staff/publish-social")
        self.assertEqual(safe_return_to("/admin/x"), "/staff/publish-social")

    def test_redirect_uri_from_public_api(self):
        with patch.dict(
            "os.environ",
            {"PUBLIC_API_ORIGIN": "https://api.avtovozom.com", "VK_OAUTH_REDIRECT_URI": ""},
            clear=False,
        ):
            self.assertEqual(
                vk_oauth_redirect_uri(),
                "https://api.avtovozom.com/admin/integrations/vk/oauth/callback",
            )

    def test_mode_classic_with_secret(self):
        with patch.dict(
            "os.environ",
            {"VK_OAUTH_CLIENT_SECRET": "sec", "VK_OAUTH_MODE": ""},
            clear=False,
        ):
            self.assertEqual(vk_oauth_mode(), "classic")

    def test_begin_vkid_stores_pending(self):
        db = MagicMock()
        stored = {}

        def capture(_db, key, value):
            stored[key] = value

        with patch.dict(
            "os.environ",
            {
                "VK_OAUTH_CLIENT_SECRET": "",
                "VK_OAUTH_MODE": "vkid",
                "PUBLIC_API_ORIGIN": "http://localhost:8000",
            },
            clear=False,
        ), patch("app.vk_oauth.set_setting", side_effect=capture):
            out = begin_vk_oauth(db, return_to="/staff/publish-social/9")
            self.assertIn("id.vk.ru/authorize", out["authorize_url"])
            self.assertEqual(out["mode"], "vkid")
            pending = json.loads(stored["vk_oauth_pending"])
            self.assertEqual(pending["return_to"], "/staff/publish-social/9")
            self.assertTrue(pending.get("code_verifier"))

    def test_complete_exchanges_classic(self):
        db = MagicMock()
        pending = {
            "state": "abc",
            "mode": "classic",
            "return_to": "/staff/publish-social/3",
            "redirect_uri": "http://localhost:8000/admin/integrations/vk/oauth/callback",
            "exp": (datetime.utcnow() + timedelta(minutes=10)).isoformat(),
        }
        with patch("app.vk_oauth.get_setting", return_value=json.dumps(pending)), patch(
            "app.vk_oauth._exchange_classic",
            return_value={"access_token": "vk1.a." + "x" * 40, "expires_in": 3600},
        ), patch("app.vk_oauth.set_vk_user_token") as set_tok, patch(
            "app.vk_oauth._clear_pending"
        ):
            set_tok.return_value = datetime.utcnow() + timedelta(hours=1)
            result = complete_vk_oauth(db, code="c1", state="abc")
            self.assertTrue(result["ok"])
            self.assertEqual(result["return_to"], "/staff/publish-social/3")
            set_tok.assert_called_once()


if __name__ == "__main__":
    unittest.main()
