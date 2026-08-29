"""Tests for n8n Telegram bot integration endpoint."""

from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import get_db
from app.main import app
from app.models import CalculationRequest, Car, CarBrand, CarModel


from app.n8n_bot_integration import sanitize_consultant_reply_text


class SanitizeConsultantReplyTests(unittest.TestCase):
    def test_strips_search_tool_json_prefix(self) -> None:
        raw = (
            '{"q":"Audi","max_total_rub":2500000}\n\n'
            "Подберу варианты Audi до 2,5 млн ₽ под ключ до РФ."
        )
        self.assertEqual(
            sanitize_consultant_reply_text(raw),
            "Подберу варианты Audi до 2,5 млн ₽ под ключ до РФ.",
        )

    def test_strips_empty_tool_json(self) -> None:
        self.assertEqual(sanitize_consultant_reply_text("{} Ответ"), "Ответ")

    def test_keeps_normal_text(self) -> None:
        self.assertEqual(sanitize_consultant_reply_text("Здравствуйте!"), "Здравствуйте!")

    def test_keeps_unrelated_json(self) -> None:
        raw = '{"note":"hello"} Текст'
        self.assertEqual(sanitize_consultant_reply_text(raw), raw)


class N8nBotIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        CarBrand.__table__.create(bind=self.engine)
        CarModel.__table__.create(bind=self.engine)
        Car.__table__.create(bind=self.engine)
        CalculationRequest.__table__.create(bind=self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

        brand = CarBrand(name="TestBrand")
        self.db.add(brand)
        self.db.flush()
        model = CarModel(brand_id=brand.id, name="TestModel")
        self.db.add(model)
        self.db.flush()
        car = Car(
            source="manual",
            source_listing_id="test-1",
            brand_id=brand.id,
            model_id=model.id,
            title="Test Car",
            year=2022,
            engine_volume_cc=2000,
            horsepower=200,
            price_cny=100000.0,
            is_active=True,
        )
        self.db.add(car)
        self.db.commit()
        self.car_id = car.id

        def override_get_db():
            try:
                yield self.db
            finally:
                pass

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)
        os.environ["N8N_TELEGRAM_BOT_API_SECRET"] = "test-secret"

    def tearDown(self) -> None:
        app.dependency_overrides.clear()
        os.environ.pop("N8N_TELEGRAM_BOT_API_SECRET", None)
        self.db.close()

    @patch("app.n8n_bot_integration.notify_calculation_request")
    def test_create_request_with_car_id(self, notify_mock) -> None:
        r = self.client.post(
            "/integrations/n8n/bot/create-request",
            json={
                "user_name": "Иван",
                "user_contact": "+79990001122",
                "car_id": self.car_id,
                "comment": "Нужен расчёт под ключ",
                "telegram_chat_id": "123",
                "telegram_username": "ivan",
            },
            headers={"X-N8N-Webhook-Secret": "test-secret"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertTrue(data["ok"])
        req = self.db.execute(
            select(CalculationRequest).where(CalculationRequest.id == data["request_id"])
        ).scalar_one()
        self.assertEqual(req.car_id, self.car_id)
        self.assertEqual(req.source, "telegram_bot")
        notify_mock.assert_called_once()

    @patch("app.n8n_bot_integration.notify_calculation_request")
    def test_create_request_without_car_id(self, notify_mock) -> None:
        r = self.client.post(
            "/integrations/n8n/bot/create-request",
            json={
                "user_name": "Anna",
                "user_contact": "anna@example.com",
                "comment": "Zeekr 001 2024, белый, бюджет до 5 млн",
            },
            headers={"X-N8N-Webhook-Secret": "test-secret"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        req_id = r.json()["request_id"]
        req = self.db.execute(
            select(CalculationRequest).where(CalculationRequest.id == req_id)
        ).scalar_one()
        self.assertIsNone(req.car_id)
        self.assertEqual(req.source, "telegram_bot")
        notify_mock.assert_called_once()

    @patch("app.n8n_bot_integration.notify_calculation_request")
    def test_create_request_guest_web_source(self, notify_mock) -> None:
        r = self.client.post(
            "/integrations/n8n/bot/create-request",
            json={
                "user_name": "Гость",
                "user_contact": "+79991112233",
                "comment": "Нужен BYD Seal, бюджет 4 млн",
                "source": "guest_web",
                "guest_token": "abc123guesttokenXX",
            },
            headers={"X-N8N-Webhook-Secret": "test-secret"},
        )
        self.assertEqual(r.status_code, 200, r.text)
        req = self.db.execute(
            select(CalculationRequest).where(CalculationRequest.id == r.json()["request_id"])
        ).scalar_one()
        self.assertEqual(req.source, "guest_web")
        self.assertIn("guest:", req.user_contact)
        notify_mock.assert_called_once()
        self.assertEqual(notify_mock.call_args.kwargs.get("source"), "guest_web")

    def test_forbidden_without_secret(self) -> None:
        r = self.client.post(
            "/integrations/n8n/bot/create-request",
            json={
                "user_name": "X",
                "user_contact": "x@x.com",
                "comment": "test comment here",
            },
        )
        self.assertEqual(r.status_code, 403)


if __name__ == "__main__":
    unittest.main()
