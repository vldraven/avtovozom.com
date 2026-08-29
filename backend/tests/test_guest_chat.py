"""Guest chat public API + staff inbox visibility."""

from __future__ import annotations

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


class GuestChatApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        # Only tables needed for guest chat (full Base.metadata hits PG-only defaults).
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

    def tearDown(self) -> None:
        app.dependency_overrides.clear()
        self.db.close()
        self.engine.dispose()

    def _admin_headers(self):
        token = create_access_token(str(self.admin.id))
        return {"Authorization": f"Bearer {token}"}

    @patch("app.main.notify_guest_chat_started")
    @patch("app.main.notify_guest_chat_message")
    def test_new_guest_chat_notifies_telegram(self, mock_msg, mock_started):
        res = self.client.post(
            "/public/guest-chats/messages",
            json={"text": "Здравствуйте, хочу Toyota"},
        )
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertTrue(body["guest_token"])
        self.assertTrue(body["chat_id"])
        self.assertEqual(body["message"]["text"], "Здравствуйте, хочу Toyota")
        self.assertIsNone(body["message"]["sender_user_id"])
        mock_started.assert_called_once()
        mock_msg.assert_not_called()

        token = body["guest_token"]
        res2 = self.client.post(
            "/public/guest-chats/messages",
            json={"guest_token": token, "text": "Ещё вопрос"},
        )
        self.assertEqual(res2.status_code, 200, res2.text)
        mock_msg.assert_called_once()
        self.assertEqual(mock_started.call_count, 1)

        msgs = self.client.get(f"/public/guest-chats/{token}/messages")
        self.assertEqual(msgs.status_code, 200)
        self.assertEqual(len(msgs.json()), 2)

        inbox = self.client.get("/chats/my", headers=self._admin_headers())
        self.assertEqual(inbox.status_code, 200)
        items = inbox.json()
        self.assertTrue(any(c["chat_type"] == "guest" and c["id"] == body["chat_id"] for c in items))

        reply = self.client.post(
            f"/chats/{body['chat_id']}/messages",
            headers=self._admin_headers(),
            data={"text": "Добрый день!"},
        )
        self.assertEqual(reply.status_code, 200, reply.text)
        self.assertEqual(reply.json()["sender_user_id"], self.admin.id)

        msgs2 = self.client.get(f"/public/guest-chats/{token}/messages")
        self.assertEqual(len(msgs2.json()), 3)

    @patch("app.main.notify_guest_chat_started")
    @patch("app.main.notify_guest_chat_message")
    @patch("app.main.trigger_guest_chat_ai")
    @patch("app.main.guest_chat_ai_webhook_configured", return_value=True)
    def test_guest_message_triggers_ai_webhook(
        self, _configured, mock_trigger, mock_msg, mock_started
    ):
        res = self.client.post(
            "/public/guest-chats/messages",
            json={"text": "Нужна Toyota"},
        )
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        mock_trigger.assert_called_once()
        payload = mock_trigger.call_args.args[0]
        self.assertEqual(payload["guest_token"], body["guest_token"])
        self.assertEqual(payload["chat_id"], body["chat_id"])
        self.assertEqual(payload["text"], "Нужна Toyota")
        self.assertTrue(payload["created"])

        # After staff reply, AI should not fire again
        mock_trigger.reset_mock()
        reply = self.client.post(
            f"/chats/{body['chat_id']}/messages",
            headers=self._admin_headers(),
            data={"text": "Я менеджер"},
        )
        self.assertEqual(reply.status_code, 200, reply.text)
        res2 = self.client.post(
            "/public/guest-chats/messages",
            json={"guest_token": body["guest_token"], "text": "Ещё вопрос"},
        )
        self.assertEqual(res2.status_code, 200, res2.text)
        mock_trigger.assert_not_called()

    @patch("app.main.notify_guest_chat_started")
    def test_guest_bot_reply_endpoint(self, _started):
        import os

        os.environ["N8N_TELEGRAM_BOT_API_SECRET"] = "guest-reply-secret"
        try:
            created = self.client.post(
                "/public/guest-chats/messages",
                json={"text": "Привет"},
            )
            self.assertEqual(created.status_code, 200, created.text)
            token = created.json()["guest_token"]
            chat_id = created.json()["chat_id"]

            denied = self.client.post(
                "/integrations/n8n/bot/guest-reply",
                json={"guest_token": token, "chat_id": chat_id, "text": "Здравствуйте!"},
            )
            self.assertEqual(denied.status_code, 403)

            ok = self.client.post(
                "/integrations/n8n/bot/guest-reply",
                json={
                    "guest_token": token,
                    "chat_id": chat_id,
                    "text": (
                        '{"q":"Audi","max_total_rub":2500000}\n\n'
                        "Подберу варианты Audi до 2,5 млн ₽ под ключ до РФ."
                    ),
                },
                headers={"X-N8N-Webhook-Secret": "guest-reply-secret"},
            )
            self.assertEqual(ok.status_code, 200, ok.text)
            self.assertTrue(ok.json()["ok"])

            msgs = self.client.get(f"/public/guest-chats/{token}/messages")
            self.assertEqual(msgs.status_code, 200)
            body = msgs.json()
            self.assertEqual(len(body), 2)
            assistant = body[1]
            self.assertEqual(assistant["message_type"], "assistant")
            self.assertEqual(
                assistant["text"],
                "Подберу варианты Audi до 2,5 млн ₽ под ключ до РФ.",
            )
            self.assertIsNone(assistant["sender_user_id"])
        finally:
            os.environ.pop("N8N_TELEGRAM_BOT_API_SECRET", None)

    @patch("app.main.notify_guest_chat_started")
    def test_guest_bot_reply_plain_text(self, _started):
        import os

        os.environ["N8N_TELEGRAM_BOT_API_SECRET"] = "guest-reply-secret"
        try:
            created = self.client.post(
                "/public/guest-chats/messages",
                json={"text": "Привет"},
            )
            self.assertEqual(created.status_code, 200, created.text)
            token = created.json()["guest_token"]
            chat_id = created.json()["chat_id"]

            denied = self.client.post(
                "/integrations/n8n/bot/guest-reply",
                json={"guest_token": token, "chat_id": chat_id, "text": "Здравствуйте!"},
            )
            self.assertEqual(denied.status_code, 403)

            ok = self.client.post(
                "/integrations/n8n/bot/guest-reply",
                json={"guest_token": token, "chat_id": chat_id, "text": "Здравствуйте!"},
                headers={"X-N8N-Webhook-Secret": "guest-reply-secret"},
            )
            self.assertEqual(ok.status_code, 200, ok.text)
            self.assertTrue(ok.json()["ok"])

            msgs = self.client.get(f"/public/guest-chats/{token}/messages")
            self.assertEqual(msgs.status_code, 200)
            body = msgs.json()
            self.assertEqual(len(body), 2)
            assistant = body[1]
            self.assertEqual(assistant["message_type"], "assistant")
            self.assertEqual(assistant["text"], "Здравствуйте!")
            self.assertIsNone(assistant["sender_user_id"])
        finally:
            os.environ.pop("N8N_TELEGRAM_BOT_API_SECRET", None)

    @patch("app.main.notify_guest_chat_started")
    @patch("app.main.notify_guest_chat_message")
    def test_staff_can_delete_guest_chat(self, mock_msg, mock_started):
        res = self.client.post(
            "/public/guest-chats/messages",
            json={"text": "Удалите меня"},
        )
        self.assertEqual(res.status_code, 200, res.text)
        chat_id = res.json()["chat_id"]
        token = res.json()["guest_token"]

        denied = self.client.delete(f"/chats/{chat_id}")
        self.assertEqual(denied.status_code, 401)

        ok = self.client.delete(f"/chats/{chat_id}", headers=self._admin_headers())
        self.assertEqual(ok.status_code, 200, ok.text)
        self.assertTrue(ok.json().get("ok"))

        gone = self.client.get(f"/public/guest-chats/{token}/messages")
        self.assertEqual(gone.status_code, 404)

        inbox = self.client.get("/chats/my", headers=self._admin_headers())
        self.assertEqual(inbox.status_code, 200)
        self.assertFalse(any(c["id"] == chat_id for c in inbox.json()))
        self.db.expire_all()
        self.assertIsNone(self.db.get(Chat, chat_id))
        self.assertEqual(
            self.db.query(ChatMessage).filter(ChatMessage.chat_id == chat_id).count(),
            0,
        )


if __name__ == "__main__":
    unittest.main()
