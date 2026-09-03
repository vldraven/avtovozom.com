"""Admin calculation request → platform chat with client."""

from __future__ import annotations

import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.admin_request_chat import (
    extract_emails_from_contact,
    resolve_request_client_user,
)
from app.db import get_db
from app.main import app
from app.models import CalculationRequest, Chat, ChatMessage, DealerOffer, Role, User
from app.security import create_access_token, hash_password


class ExtractEmailTests(unittest.TestCase):
    def test_freeform_contact(self) -> None:
        self.assertEqual(
            extract_emails_from_contact("+76919606619; email: aboramov75@mail.ru"),
            ["aboramov75@mail.ru"],
        )

    def test_bare_email(self) -> None:
        self.assertEqual(extract_emails_from_contact("a@b.co"), ["a@b.co"])

    def test_empty(self) -> None:
        self.assertEqual(extract_emails_from_contact(""), [])
        self.assertEqual(extract_emails_from_contact(None), [])


class AdminRequestPlatformChatTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Role.__table__.create(bind=self.engine)
        User.__table__.create(bind=self.engine)
        CalculationRequest.__table__.create(bind=self.engine)
        DealerOffer.__table__.create(bind=self.engine)
        Chat.__table__.create(bind=self.engine)
        ChatMessage.__table__.create(bind=self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

        admin_role = Role(code="admin", name="Admin")
        user_role = Role(code="user", name="User")
        self.db.add_all([admin_role, user_role])
        self.db.flush()
        self.admin = User(
            email="admin@example.com",
            password_hash=hash_password("pass"),
            role_id=admin_role.id,
            full_name="Admin",
            email_verified=True,
        )
        self.client_user = User(
            email="aboramov75@mail.ru",
            password_hash=hash_password("pass"),
            role_id=user_role.id,
            full_name="Георгий",
            phone="+76919606619",
            email_verified=True,
        )
        self.db.add_all([self.admin, self.client_user])
        self.db.commit()
        self.db.refresh(self.admin)
        self.db.refresh(self.client_user)

        def override_get_db():
            try:
                yield self.db
            finally:
                pass

        app.dependency_overrides[get_db] = override_get_db
        self.http = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()
        self.db.close()

    def _admin_headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {create_access_token(str(self.admin.id))}"}

    def test_resolve_freeform_by_email(self) -> None:
        req = CalculationRequest(
            user_name="Георгий",
            user_contact="+76919606619; email: aboramov75@mail.ru",
            user_id=None,
            car_id=None,
            comment="Нужен расчёт до СПб",
            source="freeform",
            status="open",
        )
        self.db.add(req)
        self.db.commit()
        self.db.refresh(req)
        found = resolve_request_client_user(self.db, req)
        self.assertIsNotNone(found)
        self.assertEqual(found.id, self.client_user.id)

    def test_open_platform_chat_for_freeform_after_register(self) -> None:
        req = CalculationRequest(
            user_name="Георгий",
            user_contact="+76919606619; email: aboramov75@mail.ru",
            user_id=None,
            car_id=None,
            comment="Нужен расчёт до СПб, бюджет 2 млн",
            source="freeform",
            status="open",
        )
        self.db.add(req)
        self.db.commit()
        self.db.refresh(req)

        denied = self.http.post(f"/admin/calculation-requests/{req.id}/open-platform-chat")
        self.assertEqual(denied.status_code, 401)

        ok = self.http.post(
            f"/admin/calculation-requests/{req.id}/open-platform-chat",
            headers=self._admin_headers(),
        )
        self.assertEqual(ok.status_code, 200, ok.text)
        chat_id = ok.json()["chat_id"]
        self.assertTrue(chat_id)

        self.db.refresh(req)
        self.assertEqual(req.user_id, self.client_user.id)

        chat = self.db.execute(select(Chat).where(Chat.id == chat_id)).scalar_one()
        self.assertEqual(chat.chat_type, "platform")
        self.assertEqual(chat.user_id, self.client_user.id)

        msgs = (
            self.db.execute(select(ChatMessage).where(ChatMessage.chat_id == chat_id))
            .scalars()
            .all()
        )
        self.assertTrue(any(f"№{req.id}" in (m.text or "") for m in msgs))

        detail = self.http.get(
            f"/admin/calculation-requests/{req.id}",
            headers=self._admin_headers(),
        )
        self.assertEqual(detail.status_code, 200, detail.text)
        body = detail.json()
        self.assertEqual(body["platform_chat_id"], chat_id)
        self.assertEqual(body["client_user_id"], self.client_user.id)
        self.assertEqual(body["client_email"], "aboramov75@mail.ru")

    def test_open_platform_chat_unregistered_freeform(self) -> None:
        req = CalculationRequest(
            user_name="Гость",
            user_contact="+70001112233; email: nobody-yet@example.com",
            user_id=None,
            car_id=None,
            comment="Хочу BYD",
            source="freeform",
            status="open",
        )
        self.db.add(req)
        self.db.commit()
        self.db.refresh(req)

        res = self.http.post(
            f"/admin/calculation-requests/{req.id}/open-platform-chat",
            headers=self._admin_headers(),
        )
        self.assertEqual(res.status_code, 404)
        self.assertIn("не зарегистрирован", res.json()["detail"])


if __name__ == "__main__":
    unittest.main()
