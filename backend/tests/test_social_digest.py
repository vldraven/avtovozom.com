"""Tests for social digest (new arrivals) compose / AI / publish."""

from __future__ import annotations

import os
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.models import Car, CarBrand, CarGeneration, CarModel, CarPhoto
from app.social_agent import router as social_router
from app.social_digest import (
    build_digest_skeleton,
    compose_digest,
    parse_msk_date,
    period_label,
)


def _make_app():
    app = FastAPI()
    app.include_router(social_router)
    return app


class SocialDigestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(
            bind=self.engine,
            tables=[
                CarBrand.__table__,
                CarModel.__table__,
                CarGeneration.__table__,
                Car.__table__,
                CarPhoto.__table__,
            ],
        )
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

        brand = CarBrand(name="Kia")
        self.db.add(brand)
        self.db.flush()
        model = CarModel(brand_id=brand.id, name="Seltos")
        self.db.add(model)
        self.db.flush()
        self.brand_id = brand.id
        self.model_id = model.id
        self._listing_seq = 0

        def override_get_db():
            try:
                yield self.db
            finally:
                pass

        app = _make_app()
        app.dependency_overrides[get_db] = override_get_db
        self.app = app
        self.client = TestClient(app)
        os.environ["AGENT_API_SECRET"] = "agent-test-secret"
        os.environ["PUBLIC_WEB_ORIGIN"] = "https://avtovozom.com"
        os.environ["PUBLIC_API_ORIGIN"] = "https://api.avtovozom.com"
        os.environ["N8N_DIGEST_AI_WEBHOOK_URL"] = "https://n8n.example/webhook/digest"
        self.headers = {"X-Agent-Secret": "agent-test-secret"}

    def tearDown(self) -> None:
        self.app.dependency_overrides.clear()
        for key in (
            "AGENT_API_SECRET",
            "PUBLIC_WEB_ORIGIN",
            "PUBLIC_API_ORIGIN",
            "N8N_DIGEST_AI_WEBHOOK_URL",
        ):
            os.environ.pop(key, None)
        self.db.close()

    def _add_car(
        self,
        *,
        year: int = 2023,
        mileage: int = 12000,
        price: float = 2_020_000,
        created_at: datetime | None = None,
        with_photo: bool = True,
        active: bool = True,
    ) -> Car:
        self._listing_seq += 1
        listing_id = f"digest-{self._listing_seq}"
        car = Car(
            source="che168",
            source_listing_id=listing_id,
            brand_id=self.brand_id,
            model_id=self.model_id,
            title=f"Kia Seltos {year}",
            year=year,
            mileage_km=mileage,
            engine_volume_cc=1500,
            horsepower=115,
            fuel_type="Бензин",
            transmission="AT",
            price_cny=90000,
            is_active=active,
            estimated_total_rub=price,
            created_at=created_at or datetime.utcnow(),
        )
        self.db.add(car)
        self.db.flush()
        if with_photo:
            self.db.add(
                CarPhoto(
                    car_id=car.id,
                    storage_url=f"/media/cars/{car.id}/cover.jpg",
                    sort_order=0,
                )
            )
        self.db.commit()
        self.db.refresh(car)
        return car

    def test_parse_msk_date_bounds(self) -> None:
        start = parse_msk_date("2026-03-18", end_of_day=False)
        end = parse_msk_date("2026-03-18", end_of_day=True)
        self.assertIsNotNone(start)
        self.assertIsNotNone(end)
        self.assertLess(start, end)
        self.assertEqual(period_label("2026-03-18", "2026-03-18"), "2026-03-18")
        self.assertEqual(period_label("2026-03-01", "2026-03-18"), "2026-03-01 — 2026-03-18")

    def test_skeleton_contains_price_specs_and_url(self) -> None:
        items = [
            {
                "title": "Kia Seltos 2023",
                "price_label": "≈ 2,02 млн ₽",
                "specs_line": "12 000 км · 1.5 · 115 л.с.",
                "brand": "Kia",
                "listing_web_url": "https://avtovozom.com/catalog/kia/seltos/689",
            }
        ]
        text = build_digest_skeleton(items, period_label="2026-03-18")
        self.assertIn("Kia Seltos 2023", text)
        self.assertIn("≈ 2,02 млн ₽", text)
        self.assertIn("12 000 км · 1.5 · 115 л.с.", text)
        self.assertIn("https://avtovozom.com/catalog/kia/seltos/689", text)
        self.assertIn("@avtovozombot", text)

    def test_compose_filters_by_period_and_limit(self) -> None:
        now = datetime.utcnow()
        old = self._add_car(created_at=now - timedelta(days=20))
        fresh1 = self._add_car(created_at=now - timedelta(hours=2), year=2023)
        fresh2 = self._add_car(created_at=now - timedelta(hours=1), year=2024)
        inactive = self._add_car(created_at=now, active=False)

        today = datetime.utcnow().date().isoformat()
        week_ago = (datetime.utcnow().date() - timedelta(days=6)).isoformat()
        data = compose_digest(self.db, date_from=week_ago, date_to=today, limit=10)
        ids = {it["car_id"] for it in data["items"]}
        self.assertIn(fresh1.id, ids)
        self.assertIn(fresh2.id, ids)
        self.assertNotIn(old.id, ids)
        self.assertNotIn(inactive.id, ids)
        self.assertTrue(data["skeleton_text"])
        self.assertTrue(data["cover_photo_urls"])

        limited = compose_digest(self.db, date_from=week_ago, date_to=today, limit=1)
        self.assertEqual(limited["count"], 1)

    def test_compose_by_car_ids_order(self) -> None:
        a = self._add_car(year=2022)
        b = self._add_car(year=2024)
        data = compose_digest(
            self.db,
            date_from=None,
            date_to=None,
            car_ids=[b.id, a.id],
        )
        self.assertEqual([it["car_id"] for it in data["items"]], [b.id, a.id])

    def test_agent_digest_endpoints(self) -> None:
        car = self._add_car()
        today = datetime.utcnow().date().isoformat()
        r = self.client.get(
            "/agent/v1/social/digest",
            params={"date_from": today, "date_to": today, "limit": 5},
            headers=self.headers,
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertGreaterEqual(body["count"], 1)
        self.assertTrue(any(it["car_id"] == car.id for it in body["items"]))

        with patch("app.social_digest.n8n_webhook_post") as mock_post:
            mock_post.return_value = (True, {"text": "AI DIGEST TEXT"}, "")
            ai = self.client.post(
                "/agent/v1/social/digest/ai-draft",
                headers=self.headers,
                json={"date_from": today, "date_to": today, "limit": 5},
            )
        self.assertEqual(ai.status_code, 200)
        self.assertTrue(ai.json()["ok"])
        self.assertEqual(ai.json()["text"], "AI DIGEST TEXT")

        with patch("app.social_digest.publish_telegram_via_n8n") as mock_tg, patch(
            "app.social_digest.publish_listing_to_channel"
        ) as mock_max:
            mock_tg.return_value = (True, {}, "")
            mock_max.return_value = type("R", (), {"post_url": "https://max.ru/x"})()
            pub = self.client.post(
                "/agent/v1/social/digest/publish",
                headers=self.headers,
                json={
                    "text": "Дайджест тест",
                    "car_ids": [car.id],
                    "channel_tg": True,
                    "channel_max": True,
                },
            )
        self.assertEqual(pub.status_code, 200)
        self.assertTrue(pub.json()["ok"])
        self.assertIn("Telegram", pub.json()["detail"])
        self.assertIn("MAX", pub.json()["detail"])


if __name__ == "__main__":
    unittest.main()
