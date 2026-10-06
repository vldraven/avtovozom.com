"""IndexNow bulk ping, Webmaster recrawl helpers, daily SEO tick."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import datetime
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.indexnow import post_urls_blocking
from app.models import Car, CarBrand, CarModel
from app.parser_worker import process_seo_jobs
from app.seo_jobs import (
    build_report,
    collect_indexnow_urls,
    jobs_enabled,
    priority_recrawl_urls,
    tick,
)
from app.yandex_webmaster import (
    _host_matches,
    enqueue_recrawl,
    recrawl_urls,
)

MSK_TZ = ZoneInfo("Europe/Moscow")


class IndexNowBlockingTests(unittest.TestCase):
    def test_skip_without_key(self) -> None:
        with patch.dict(
            os.environ,
            {"INDEXNOW_KEY": "", "PUBLIC_WEB_ORIGIN": "https://avtovozom.com"},
            clear=False,
        ):
            status, detail = post_urls_blocking(["https://avtovozom.com/catalog"])
        self.assertEqual(status, 0)
        self.assertIn("skip", detail)

    def test_posts_unique_urls(self) -> None:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = "ok"
        with patch.dict(
            os.environ,
            {
                "INDEXNOW_KEY": "a" * 32,
                "PUBLIC_WEB_ORIGIN": "https://avtovozom.com",
            },
            clear=False,
        ):
            with patch("app.indexnow.httpx.post", return_value=mock_resp) as post:
                status, detail = post_urls_blocking(
                    [
                        "https://avtovozom.com/",
                        "https://avtovozom.com/",
                        "https://avtovozom.com/catalog",
                    ]
                )
        self.assertEqual(status, 200)
        self.assertIn("2 urls", detail)
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["host"], "avtovozom.com")
        self.assertEqual(len(payload["urlList"]), 2)
        self.assertTrue(payload["keyLocation"].endswith("/indexnow-key.txt"))


class WebmasterHelperTests(unittest.TestCase):
    def test_host_match_by_id_and_url(self) -> None:
        host = {
            "host_id": "https:avtovozom.com:443",
            "ascii_host_url": "https://avtovozom.com/",
        }
        self.assertTrue(_host_matches(host, "avtovozom.com"))
        self.assertFalse(_host_matches(host, "example.com"))

    def test_enqueue_already_and_quota(self) -> None:
        client = MagicMock()
        already = MagicMock()
        already.status_code = 409
        already.text = "dup"
        client.post.return_value = already
        self.assertEqual(
            enqueue_recrawl(1, "https:avtovozom.com:443", "https://avtovozom.com/", client),
            "already",
        )
        quota = MagicMock()
        quota.status_code = 429
        quota.text = "limit"
        client.post.return_value = quota
        self.assertEqual(
            enqueue_recrawl(1, "https:avtovozom.com:443", "https://avtovozom.com/", client),
            "quota",
        )

    def test_recrawl_skipped_without_token(self) -> None:
        with patch.dict(os.environ, {"YANDEX_WEBMASTER_TOKEN": ""}, clear=False):
            result = recrawl_urls(["https://avtovozom.com/"], "https://avtovozom.com")
        self.assertTrue(result["skipped"])
        self.assertIn("YANDEX_WEBMASTER_TOKEN", result["reason"])


class CatalogUrlTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        CarBrand.__table__.create(bind=self.engine)
        CarModel.__table__.create(bind=self.engine)
        Car.__table__.create(bind=self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        audi = CarBrand(name="Audi")
        bmw = CarBrand(name="BMW")
        self.db.add_all([audi, bmw])
        self.db.flush()
        q5 = CarModel(brand_id=audi.id, name="Q5")
        x5 = CarModel(brand_id=bmw.id, name="X5")
        self.db.add_all([q5, x5])
        self.db.flush()
        self.db.add_all(
            [
                Car(
                    source="manual",
                    source_listing_id="a1",
                    brand_id=audi.id,
                    model_id=q5.id,
                    title="Audi Q5",
                    year=2021,
                    engine_volume_cc=2000,
                    horsepower=249,
                    price_cny=180000,
                    is_active=True,
                ),
                Car(
                    source="manual",
                    source_listing_id="a2",
                    brand_id=audi.id,
                    model_id=q5.id,
                    title="Audi Q5 2",
                    year=2022,
                    engine_volume_cc=2000,
                    horsepower=249,
                    price_cny=190000,
                    is_active=True,
                ),
                Car(
                    source="manual",
                    source_listing_id="b1",
                    brand_id=bmw.id,
                    model_id=x5.id,
                    title="BMW X5",
                    year=2020,
                    engine_volume_cc=3000,
                    horsepower=340,
                    price_cny=250000,
                    is_active=True,
                ),
                Car(
                    source="manual",
                    source_listing_id="off",
                    brand_id=bmw.id,
                    model_id=x5.id,
                    title="BMW off",
                    year=2018,
                    engine_volume_cc=3000,
                    horsepower=340,
                    price_cny=100000,
                    is_active=False,
                ),
            ]
        )
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def test_collect_includes_static_hubs_and_active_cars(self) -> None:
        with patch.dict(os.environ, {"PUBLIC_WEB_ORIGIN": "https://avtovozom.com"}, clear=False):
            urls = collect_indexnow_urls(self.db, "https://avtovozom.com")
        self.assertIn("https://avtovozom.com/", urls)
        self.assertIn("https://avtovozom.com/contacts", urls)
        self.assertIn("https://avtovozom.com/catalog/audi", urls)
        self.assertIn("https://avtovozom.com/catalog/audi/q5", urls)
        self.assertIn("https://avtovozom.com/catalog/bmw", urls)
        car_urls = [u for u in urls if "/catalog/audi/q5/" in u or "/catalog/bmw/x5/" in u]
        self.assertEqual(len(car_urls), 3)
        self.assertTrue(all("/off" not in u for u in urls))
        self.assertEqual(urls[0], "https://avtovozom.com/")

    def test_priority_recrawl_starts_with_static_then_fatter_hubs(self) -> None:
        urls = priority_recrawl_urls(self.db, "https://avtovozom.com", limit=12)
        self.assertEqual(urls[0], "https://avtovozom.com/")
        self.assertIn("https://avtovozom.com/about", urls)
        self.assertTrue(any(u.endswith("/catalog/audi") for u in urls))
        self.assertFalse(any("/catalog/audi/q5/" in u and u.rstrip("/").split("/")[-1].isdigit() for u in urls))

    def test_report_mentions_active_count(self) -> None:
        text = build_report(
            self.db,
            {
                "last_indexnow_date": "2026-09-11",
                "last_indexnow": {"http_status": 200, "count": 12, "detail": "ok 12 urls"},
                "last_recrawl_date": "2026-09-11",
                "last_recrawl": {"skipped": True, "reason": "нет YANDEX_WEBMASTER_TOKEN"},
            },
        )
        self.assertIn("Активных объявлений: 3", text)
        self.assertIn("IndexNow", text)
        self.assertIn("нет YANDEX_WEBMASTER_TOKEN", text)


class TickStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(
            os.environ,
            {
                "MEDIA_ROOT": self.tmp.name,
                "SEO_JOBS_ENABLED": "1",
                "SEO_JOBS_HOUR_MSK": "7",
                "PUBLIC_WEB_ORIGIN": "https://avtovozom.com",
                "INDEXNOW_KEY": "b" * 32,
            },
            clear=False,
        )
        self.env.start()

    def tearDown(self) -> None:
        self.env.stop()
        self.tmp.cleanup()

    def test_disabled_and_too_early(self) -> None:
        with patch.dict(os.environ, {"SEO_JOBS_ENABLED": "0"}, clear=False):
            self.assertFalse(jobs_enabled())
            out = tick(datetime(2026, 9, 14, 12, 0, tzinfo=MSK_TZ))
        self.assertTrue(out["skipped"])
        early = tick(datetime(2026, 9, 14, 3, 0, tzinfo=MSK_TZ))
        self.assertEqual(early.get("reason"), "hour")

    @patch("app.seo_jobs.send_report")
    @patch("app.seo_jobs.run_recrawl")
    @patch("app.seo_jobs.run_full_indexnow")
    @patch("app.seo_jobs.SessionLocal")
    def test_runs_once_per_day(
        self,
        session_local: MagicMock,
        run_indexnow: MagicMock,
        run_recrawl: MagicMock,
        send_report: MagicMock,
    ) -> None:
        session_local.return_value = MagicMock()
        run_indexnow.return_value = {
            "http_status": 200,
            "detail": "ok 10 urls",
            "count": 10,
            "skipped": False,
        }
        run_recrawl.return_value = {
            "skipped": True,
            "reason": "нет YANDEX_WEBMASTER_TOKEN",
            "ok": 0,
            "already": 0,
            "errors": 0,
            "quota": {},
            "sent": [],
            "summary": "",
        }
        send_report.return_value = {"sent": True, "text": "ok"}
        monday = datetime(2026, 9, 14, 10, 0, tzinfo=MSK_TZ)
        first = tick(monday)
        self.assertEqual(first["indexnow"]["http_status"], 200)
        self.assertTrue(first["recrawl"]["skipped"])
        self.assertTrue(first["report"]["sent"])
        second = tick(monday)
        self.assertEqual(second.get("reason"), "already")
        self.assertEqual(run_indexnow.call_count, 1)
        self.assertEqual(run_recrawl.call_count, 1)
        self.assertEqual(send_report.call_count, 1)
        state_path = os.path.join(self.tmp.name, ".seo_jobs_state.json")
        with open(state_path, encoding="utf-8") as fh:
            state = json.loads(fh.read())
        self.assertEqual(state["last_indexnow_date"], "2026-09-14")
        self.assertEqual(state["last_report_week"], "2026-W38")


class ParserHookTests(unittest.TestCase):
    def test_process_seo_jobs_swallows_errors(self) -> None:
        with patch("app.seo_jobs.tick", side_effect=RuntimeError("boom")):
            process_seo_jobs()


if __name__ == "__main__":
    unittest.main()
