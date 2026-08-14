"""Tests for social Telegram agent API (/agent/v1/social)."""

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
from app.models import (
    Car,
    CarBrand,
    CarExternalPublication,
    CarGeneration,
    CarModel,
    CarPhoto,
)
from app.social_agent import router as social_router
from app.social_publish import TELEGRAM_CHANNEL, build_social_compose, build_telegram_skeleton


def _make_app():
    app = FastAPI()
    app.include_router(social_router)
    return app


class SocialAgentApiTests(unittest.TestCase):
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
                CarExternalPublication.__table__,
            ],
        )
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

        brand = CarBrand(name="BMW")
        self.db.add(brand)
        self.db.flush()
        series = CarModel(brand_id=brand.id, name="3 Series")
        x5 = CarModel(brand_id=brand.id, name="X5")
        self.db.add_all([series, x5])
        self.db.flush()
        self.brand_id = brand.id
        self.series_id = series.id
        self.x5_id = x5.id

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
        self.headers = {"X-Agent-Secret": "agent-test-secret"}

    def tearDown(self) -> None:
        self.app.dependency_overrides.clear()
        for key in ("AGENT_API_SECRET", "PUBLIC_WEB_ORIGIN", "PUBLIC_API_ORIGIN"):
            os.environ.pop(key, None)
        self.db.close()

    def _add_car(
        self,
        *,
        listing_id: str,
        model_id: int,
        title: str,
        created_at: datetime | None = None,
        photos: int = 2,
        is_popular: bool = False,
        estimated_total_rub: float | None = 3_200_000,
    ) -> Car:
        car = Car(
            source="che168",
            source_listing_id=listing_id,
            brand_id=self.brand_id,
            model_id=model_id,
            title=title,
            year=2022,
            mileage_km=45000,
            engine_volume_cc=2000,
            horsepower=184,
            fuel_type="Бензин",
            transmission="AT",
            price_cny=150000,
            is_active=True,
            is_popular=is_popular,
            estimated_total_rub=estimated_total_rub,
            created_at=created_at or datetime.utcnow(),
        )
        self.db.add(car)
        self.db.flush()
        for i in range(photos):
            self.db.add(
                CarPhoto(
                    car_id=car.id,
                    storage_url=f"/media/{listing_id}-{i}.jpg",
                    sort_order=i,
                )
            )
        self.db.commit()
        self.db.refresh(car)
        return car

    def test_forbidden_without_secret(self) -> None:
        r = self.client.get("/agent/v1/social/queue")
        self.assertEqual(r.status_code, 403)

    def test_queue_latest_with_photos_excludes_blocked(self) -> None:
        older = self._add_car(
            listing_id="old-3",
            model_id=self.series_id,
            title="BMW 3 Series old",
            created_at=datetime.utcnow() - timedelta(days=3),
        )
        fresh_x5 = self._add_car(
            listing_id="new-x5",
            model_id=self.x5_id,
            title="BMW X5 fresh",
            created_at=datetime.utcnow() - timedelta(hours=1),
            is_popular=True,
        )
        no_photo = Car(
            source="che168",
            source_listing_id="no-photo",
            brand_id=self.brand_id,
            model_id=self.series_id,
            title="No photos",
            year=2021,
            engine_volume_cc=2000,
            horsepower=150,
            price_cny=100000,
            is_active=True,
            created_at=datetime.utcnow(),
        )
        self.db.add(no_photo)
        self.db.commit()

        published = self._add_car(
            listing_id="pub-1",
            model_id=self.x5_id,
            title="Already published",
            created_at=datetime.utcnow(),
        )
        self.db.add(
            CarExternalPublication(
                car_id=published.id,
                channel=TELEGRAM_CHANNEL,
                feed_ad_id=f"tg-{published.id}",
                status="published",
            )
        )
        self.db.commit()

        r = self.client.get("/agent/v1/social/queue", headers=self.headers)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        ids = [item["id"] for item in body["items"]]
        self.assertEqual(ids[0], fresh_x5.id)
        self.assertIn(older.id, ids)
        self.assertNotIn(published.id, ids)
        self.assertNotIn(no_photo.id, ids)
        self.assertTrue(body["items"][0]["is_popular"])
        self.assertIn("skeleton_text", body["items"][0])
        self.assertIn("BMW X5", body["items"][0]["skeleton_text"])

    def test_draft_moves_to_pending_then_skip(self) -> None:
        car = self._add_car(
            listing_id="draft-1",
            model_id=self.series_id,
            title="BMW 3 Series draft",
        )
        text = "Черновик поста\nhttps://avtovozom.com/cars/" + str(car.id)
        r = self.client.post(
            "/agent/v1/social/draft",
            headers=self.headers,
            json={"car_id": car.id, "text": text},
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "pending_review")

        queue = self.client.get("/agent/v1/social/queue", headers=self.headers).json()
        self.assertEqual(queue["count"], 0)

        pending = self.client.get("/agent/v1/social/pending", headers=self.headers).json()
        self.assertEqual(pending["count"], 1)
        self.assertEqual(pending["items"][0]["id"], car.id)
        self.assertEqual(pending["items"][0]["last_draft_text"], text)

        skip = self.client.post(
            "/agent/v1/social/skip",
            headers=self.headers,
            json={"car_id": car.id, "reason": "не та модель"},
        )
        self.assertEqual(skip.status_code, 200)
        self.assertEqual(skip.json()["status"], "skipped")
        pending2 = self.client.get("/agent/v1/social/pending", headers=self.headers).json()
        self.assertEqual(pending2["count"], 0)
        queue_today = self.client.get("/agent/v1/social/queue", headers=self.headers).json()
        self.assertEqual(queue_today["count"], 0)

    def test_skip_only_blocks_for_msk_day(self) -> None:
        car = self._add_car(
            listing_id="skip-day",
            model_id=self.series_id,
            title="BMW 3 Series skip day",
        )
        self.client.post(
            "/agent/v1/social/skip",
            headers=self.headers,
            json={"car_id": car.id, "reason": "не сегодня"},
        )
        self.assertEqual(self.client.get("/agent/v1/social/queue", headers=self.headers).json()["count"], 0)
        pub = (
            self.db.query(CarExternalPublication)
            .filter(
                CarExternalPublication.car_id == car.id,
                CarExternalPublication.channel == TELEGRAM_CHANNEL,
            )
            .one()
        )
        pub.updated_at = datetime.utcnow() - timedelta(days=2)
        self.db.commit()
        ids = [item["id"] for item in self.client.get("/agent/v1/social/queue", headers=self.headers).json()["items"]]
        self.assertIn(car.id, ids)

    def test_release_returns_listing_to_queue(self) -> None:
        keep = self._add_car(
            listing_id="keep-1",
            model_id=self.x5_id,
            title="BMW X5 keep",
        )
        car = self._add_car(
            listing_id="rel-1",
            model_id=self.series_id,
            title="BMW 3 Series release",
        )
        self.client.post(
            "/agent/v1/social/draft",
            headers=self.headers,
            json={"car_id": car.id, "text": "draft"},
        )
        pending = self.client.get("/agent/v1/social/pending", headers=self.headers).json()
        self.assertEqual(pending["count"], 1)
        rel = self.client.post(
            "/agent/v1/social/release",
            headers=self.headers,
            json={"car_id": car.id, "reason": "поменять авто"},
        )
        self.assertEqual(rel.status_code, 200)
        self.assertEqual(rel.json()["status"], "released")
        self.assertEqual(self.client.get("/agent/v1/social/pending", headers=self.headers).json()["count"], 0)
        queue = self.client.get("/agent/v1/social/queue", headers=self.headers).json()
        ids = [item["id"] for item in queue["items"]]
        self.assertIn(car.id, ids)
        excluded = self.client.get(
            f"/agent/v1/social/queue?exclude_ids={car.id}",
            headers=self.headers,
        ).json()
        excluded_ids = [item["id"] for item in excluded["items"]]
        self.assertNotIn(car.id, excluded_ids)
        self.assertIn(keep.id, excluded_ids)

    def test_car_compose_includes_photos(self) -> None:
        car = self._add_car(
            listing_id="photos-1",
            model_id=self.x5_id,
            title="BMW X5 photos",
            photos=3,
        )
        r = self.client.get(f"/agent/v1/social/cars/{car.id}", headers=self.headers)
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(len(data["photos"]), 3)
        self.assertTrue(data["photos"][0]["absolute_url"].startswith("https://api.avtovozom.com/"))
        self.assertIn("avtovozom.com", data["canonical_web_url"])

    def test_publish_marks_published(self) -> None:
        car = self._add_car(
            listing_id="pub-ok",
            model_id=self.series_id,
            title="BMW 3 Series publish",
        )
        with patch(
            "app.social_agent.publish_telegram_via_n8n",
            return_value=(True, {"ok": True}, ""),
        ) as mocked:
            r = self.client.post(
                "/agent/v1/social/publish",
                headers=self.headers,
                json={"car_id": car.id, "text": "Пост в канал\nhttps://avtovozom.com/x"},
            )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "published")
        mocked.assert_called_once()
        queue = self.client.get("/agent/v1/social/queue", headers=self.headers).json()
        self.assertEqual(queue["count"], 0)

    def test_skeleton_has_price_and_url(self) -> None:
        car = self._add_car(
            listing_id="skel-1",
            model_id=self.x5_id,
            title="BMW X5 2022 xDrive",
        )
        car = self.db.get(Car, car.id)
        _ = car.brand, car.model, car.photos
        compose = build_social_compose(self.db, car)
        text = build_telegram_skeleton(compose)
        self.assertIn("BMW X5 2022 xDrive", text)
        self.assertIn("3 200 000", text)
        self.assertIn("https://avtovozom.com/", text)

    def test_ai_draft_calls_existing_n8n_webhook(self) -> None:
        car = self._add_car(
            listing_id="ai-1",
            model_id=self.x5_id,
            title="BMW X5 ai",
        )
        with patch(
            "app.social_publish.n8n_webhook_post",
            return_value=(True, {"text": "Яркий пост 🚗\nhttps://avtovozom.com/x"}, ""),
        ) as mocked:
            r = self.client.post(
                "/agent/v1/social/ai-draft",
                headers=self.headers,
                json={"car_id": car.id, "revision": "короче"},
            )
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["ok"])
        self.assertIn("Яркий пост", r.json()["text"])
        args, kwargs = mocked.call_args
        self.assertEqual(kwargs["payload"]["event"], "telegram_ai_draft")
        self.assertIn("короче", kwargs["payload"]["style_hint"])
        self.assertIn("@avtovozombot", kwargs["payload"]["style_hint"])
        self.assertEqual(len(kwargs["payload"]["selected_photo_absolute_urls"]), 2)


if __name__ == "__main__":
    unittest.main()
