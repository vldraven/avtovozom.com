"""Unit tests for MAX publish persistence (no live API)."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.max_client import MaxApiError, MaxChannelPostResult
from app.max_publish import CHANNEL, get_max_publication, publish_car_to_max
from app.models import CarExternalPublication


class MaxPublishTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

    def tearDown(self):
        self.db.close()

    def test_publish_saves_publication(self):
        result = MaxChannelPostResult(
            message_id=555,
            post_url="https://max.ru/post/555",
            raw_message={},
        )
        with patch("app.max_publish.publish_listing_to_channel", return_value=result):
            ok, detail, meta = publish_car_to_max(
                self.db,
                car_id=10,
                text="Test post",
                photo_urls=["https://cdn.example/p.jpg"],
                listing_web_url="https://avtovozom.com/x",
            )
        self.assertTrue(ok)
        self.assertIsNone(detail)
        self.assertEqual(meta["max_url"], "https://max.ru/post/555")
        pub = get_max_publication(self.db, 10)
        self.assertIsNotNone(pub)
        assert pub is not None
        self.assertEqual(pub.channel, CHANNEL)
        self.assertEqual(pub.status, "published")
        self.assertEqual(pub.avito_item_id, 555)
        self.assertEqual(pub.avito_url, "https://max.ru/post/555")

    def test_publish_error_sets_status(self):
        with patch(
            "app.max_publish.publish_listing_to_channel",
            side_effect=MaxApiError("channel denied"),
        ):
            ok, detail, _meta = publish_car_to_max(
                self.db,
                car_id=10,
                text="Test",
                photo_urls=[],
                listing_web_url="",
            )
        self.assertFalse(ok)
        self.assertIn("channel denied", detail or "")
        pub = self.db.execute(
            select(CarExternalPublication).where(
                CarExternalPublication.car_id == 10,
                CarExternalPublication.channel == CHANNEL,
            )
        ).scalar_one()
        self.assertEqual(pub.status, "error")
        self.assertIn("channel denied", pub.last_error or "")


if __name__ == "__main__":
    unittest.main()
