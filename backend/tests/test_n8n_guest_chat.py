"""Guest chat ↔ n8n consultant integration."""

from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import get_db
from app.main import app
from app.models import Chat, ChatMessage, Role, User
from app.security import create_access_token, hash_password


class GuestChatN8nIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Role.__table__.create(bind=self.engine)
        User.__table__.create(bind=self.engine)
        Chat.__table__.create(bind=self.engine)
        ChatMessage.__table__.create(bind=self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

        admin_role = Role(code="admin", name="Admin")
        self.db.add(admin_role)
        self.db.flush()
        self.admin = User(
            email="admin@example.com",
            password_hash=hash_password("pass"),
            role_id=admin_role.id,
            full_name="Admin",
            is_active=True,
            email_verified=True,
        )
        self.db.add(self.admin)
        self.db.commit()
        self.db.refresh(self.admin)

        def _override_get_db():
            try:
                yield self.db
            finally:
                pass

        app.dependency_overrides[get_db] = _override_get_db
        self.client = TestClient(app)
        os.environ["N8N_TELEGRAM_BOT_API_SECRET"] = "test-secret"
        os.environ.pop("N8N_GUEST_CHAT_WEBHOOK_URL", None)
        os.environ.pop("N8N_GUEST_CHAT_SENDER_USER_ID", None)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()
        for key in (
            "N8N_TELEGRAM_BOT_API_SECRET",
            "N8N_GUEST_CHAT_WEBHOOK_URL",
            "N8N_GUEST_CHAT_WEBHOOK_SECRET",
            "N8N_GUEST_CHAT_SENDER_USER_ID",
        ):
            os.environ.pop(key, None)
        self.db.close()
        self.engine.dispose()

    def _create_guest_chat(self) -> tuple[int, str]:
        with patch("app.main.notify_guest_chat_started"), patch(
            "app.main.notify_guest_chat_message"
        ):
            res = self.client.post(
                "/public/guest-chats/messages",
                json={"text": "Хочу Audi"},
            )
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        return body["chat_id"], body["guest_token"]

    def test_n8n_reply_appears_for_guest(self) -> None:
        chat_id, token = self._create_guest_chat()
        r = self.client.post(
            f"/integrations/n8n/guest-chats/{chat_id}/messages",
            json={"text": "Нашёл несколько вариантов Audi"},
            headers={"X-N8N-Webhook-Secret": "test-secret"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["chat_id"], chat_id)

        msgs = self.client.get(f"/public/guest-chats/{token}/messages")
        self.assertEqual(msgs.status_code, 200)
        data = msgs.json()
        self.assertEqual(len(data), 2)
        self.assertEqual(data[0]["sender_user_id"], None)
        self.assertEqual(data[1]["sender_user_id"], self.admin.id)
        self.assertIn("Audi", data[1]["text"])

    def test_n8n_reply_forbidden_without_secret(self) -> None:
        chat_id, _ = self._create_guest_chat()
        r = self.client.post(
            f"/integrations/n8n/guest-chats/{chat_id}/messages",
            json={"text": "секрет?"},
            headers={"X-N8N-Webhook-Secret": "wrong"},
        )
        self.assertEqual(r.status_code, 403)

    @patch("app.n8n_guest_chat.notify_guest_chat_handoff")
    def test_n8n_handoff_notifies(self, handoff_mock) -> None:
        chat_id, _ = self._create_guest_chat()
        r = self.client.post(
            f"/integrations/n8n/guest-chats/{chat_id}/handoff",
            json={"reason": "Просит менеджера"},
            headers={"X-N8N-Webhook-Secret": "test-secret"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(r.json()["ok"])
        handoff_mock.assert_called_once()
        self.assertEqual(handoff_mock.call_args.kwargs["chat_id"], chat_id)

    @patch("app.main.forward_guest_message_to_n8n")
    @patch("app.main.notify_guest_chat_started")
    @patch("app.main.notify_guest_chat_message")
    def test_guest_send_forwards_when_webhook_configured(
        self, mock_msg, mock_started, forward_mock
    ) -> None:
        os.environ["N8N_GUEST_CHAT_WEBHOOK_URL"] = "https://n8n.example/webhook/guest"
        res = self.client.post(
            "/public/guest-chats/messages",
            json={"text": "Привет консультант"},
        )
        self.assertEqual(res.status_code, 200, res.text)
        mock_started.assert_called_once()
        forward_mock.assert_called_once()
        kwargs = forward_mock.call_args.kwargs
        self.assertEqual(kwargs["text"], "Привет консультант")
        self.assertTrue(kwargs["created"])
        self.assertTrue(kwargs["chat_id"])
        self.assertTrue(kwargs["guest_token"])

    @patch("app.main.forward_guest_message_to_n8n")
    @patch("app.main.notify_guest_chat_started")
    def test_guest_send_skips_forward_without_webhook(
        self, mock_started, forward_mock
    ) -> None:
        res = self.client.post(
            "/public/guest-chats/messages",
            json={"text": "Без n8n"},
        )
        self.assertEqual(res.status_code, 200, res.text)
        mock_started.assert_called_once()
        forward_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
