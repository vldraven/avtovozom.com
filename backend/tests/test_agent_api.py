"""Tests for Agent API (/agent/v1)."""

from __future__ import annotations

import os
import unittest
from datetime import datetime
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app import models  # noqa: F401
from app.main import app
from app.che168_parser import ListingCard
from app.models import Car, CarBrand, CarModel, ImportCandidate, SearchProfile


class AgentApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

        brand = CarBrand(name="Audi")
        self.db.add(brand)
        self.db.flush()
        model = CarModel(
            brand_id=brand.id,
            name="A6",
            che168_url="https://www.che168.com/series/test/",
        )
        self.db.add(model)
        self.db.flush()
        self.db.add(CarModel(brand_id=brand.id, name="Q3"))
        self.db.flush()
        self.brand_id = brand.id
        self.model_id = model.id

        profile = SearchProfile(
            name="Ежедневный отбор",
            enabled=True,
            criteria={"year_min": 2019, "mileage_max": 100000, "marketplaces": ["che168"]},
            brief="ликвидные",
            max_select=20,
        )
        self.db.add(profile)
        self.db.commit()
        self.profile_id = profile.id

        def override_get_db():
            try:
                yield self.db
            finally:
                pass

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)
        os.environ["AGENT_API_SECRET"] = "agent-test-secret"
        self.headers = {"X-Agent-Secret": "agent-test-secret"}

    def tearDown(self) -> None:
        app.dependency_overrides.clear()
        os.environ.pop("AGENT_API_SECRET", None)
        self.db.close()

    def test_forbidden_without_secret(self) -> None:
        r = self.client.get("/agent/v1/profiles")
        self.assertEqual(r.status_code, 403)

    def test_list_profiles(self) -> None:
        r = self.client.get("/agent/v1/profiles", headers=self.headers)
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertTrue(any(p["id"] == self.profile_id for p in data))

    def test_series_url_entries_keep_brand_model(self) -> None:
        from app.agent_api import parse_series_url_item, series_url_entries_from_payload

        url, brand_id, model_id = parse_series_url_item(
            {
                "url": "https://www.che168.com/china/aodi/aodiq3/",
                "brand_id": self.brand_id,
                "model_id": self.model_id,
            }
        )
        self.assertTrue(url.endswith("/"))
        self.assertEqual(brand_id, self.brand_id)
        self.assertEqual(model_id, self.model_id)

        entries = series_url_entries_from_payload(
            [
                "https://www.che168.com/china/aodi/aodiq3/",
                {
                    "url": "https://www.che168.com/china/aodi/aodiq3/?x=1",
                    "brand_id": self.brand_id,
                    "model_id": self.model_id,
                },
            ]
        )
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["brand_id"], self.brand_id)
        self.assertEqual(entries[0]["model_id"], self.model_id)

        with self.assertRaises(ValueError):
            series_url_entries_from_payload(["[object Object]"])
        with self.assertRaises(ValueError):
            series_url_entries_from_payload(
                ["https://www.che168.com/[object Object]/"]
            )
        mixed = series_url_entries_from_payload(
            [
                "[object Object]",
                "https://www.che168.com/china/aodi/aodiq3/",
            ]
        )
        self.assertEqual(len(mixed), 1)
        self.assertIn("aodiq3", mixed[0]["url"])

    def test_quota_and_memory(self) -> None:
        r = self.client.get(
            f"/agent/v1/quota?profile_id={self.profile_id}",
            headers=self.headers,
        )
        self.assertEqual(r.status_code, 200)
        q = r.json()
        self.assertEqual(q["needed"], 20)
        self.assertEqual(q["already_today"], 0)

        r2 = self.client.post(
            "/agent/v1/memory",
            headers=self.headers,
            json={
                "agent_key": "sourcing",
                "kind": "lesson",
                "content": "Не брать серых дилеров",
                "source": "tg_revise",
            },
        )
        self.assertEqual(r2.status_code, 200)
        mem = self.client.get(
            "/agent/v1/memory?agent_key=sourcing",
            headers=self.headers,
        )
        self.assertEqual(mem.status_code, 200)
        self.assertEqual(len(mem.json()), 1)

    def test_filter_rejects_catalog_duplicate(self) -> None:
        self.db.add(
            Car(
                source="che168",
                source_listing_id="dup-1",
                brand_id=self.brand_id,
                model_id=self.model_id,
                title="Dup",
                year=2021,
                is_active=True,
            )
        )
        cand = ImportCandidate(
            profile_id=self.profile_id,
            url="https://www.che168.com/dealer/x/y.html",
            listing_id="dup-1",
            marketplace="che168",
            brand_name="Audi",
            year=2021,
            mileage_km=30000,
            status="new",
            reasons=[],
            filter_reasons=[],
        )
        self.db.add(cand)
        self.db.commit()

        r = self.client.post(
            "/agent/v1/filter",
            headers=self.headers,
            json={"profile_id": self.profile_id},
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(len(body["rejected"]), 1)
        self.assertIn("already_in_catalog", body["rejected"][0]["filter_reasons"])

    @patch("app.agent_api.marketplace_from_detail_url", return_value="che168")
    @patch(
        "app.agent_api.normalize_import_detail_url",
        side_effect=lambda u: u,
    )
    @patch("app.agent_api.source_listing_id_from_url", return_value="list-99")
    @patch("app.agent_api.parse_che168_listing_cards_many")
    def test_discover_and_apply(self, mock_cards, *_mocks) -> None:
        series = (
            "https://www.che168.com/china/aodi/aodiq3/a3_5msdgscncgpi1ltocspexx0"
        )
        mock_cards.return_value = [
            (
                series,
                [
                    ListingCard(
                        url="https://www.che168.com/dealer/1/99.html",
                        title="奥迪Q3 2022款",
                        year=2022,
                        price_cny=188000,
                        mileage_km=20000,
                    )
                ],
                None,
            )
        ]
        r = self.client.post(
            "/agent/v1/discover",
            headers=self.headers,
            json={
                "profile_id": self.profile_id,
                "series_urls": [
                    "https://www.che168.com/china/aodi/aodiq3/a3_5msdgscncgpi1ltocspexx0/"
                ],
                "use_whitelist": False,
                "limit_per_series": 10,
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["created"], 1)
        cand = r.json()["candidates"][0]
        self.assertEqual(cand["brand_name"], "Audi")
        self.assertEqual(cand["model_name"], "Q3")
        self.assertIsNotNone(cand["model_id"])
        self.assertEqual(cand["year"], 2022)
        self.assertEqual(cand["mileage_km"], 20000)
        self.assertEqual(cand["price_cny"], 188000)

        cand_id = cand["id"]

        score = self.client.post(
            "/agent/v1/candidates/score",
            headers=self.headers,
            json={
                "items": [
                    {
                        "id": cand_id,
                        "score": 88,
                        "reasons": ["ликвидная"],
                        "year": 2022,
                        "mileage_km": 20000,
                        "title": "奥迪Q3 2020款",
                    }
                ]
            },
        )
        self.assertEqual(score.status_code, 200)
        scored = score.json()[0]
        self.assertEqual(scored["model_name"], "Q3")
        self.assertIsNotNone(scored["model_id"])

        apply = self.client.post(
            "/agent/v1/apply-to-import-plan",
            headers=self.headers,
            json={"profile_id": self.profile_id, "candidate_ids": [cand_id]},
        )
        self.assertEqual(apply.status_code, 200, apply.text)
        self.assertEqual(apply.json()["applied"], 1)
        self.assertEqual(apply.json()["skipped_missing_model"], 0)
        self.assertEqual(apply.json()["already_today"], 1)
        self.assertEqual(apply.json()["needed"], 19)

        plan = self.client.get("/agent/v1/import-plan", headers=self.headers)
        self.assertEqual(plan.status_code, 200)
        rows = plan.json()["rows"]
        self.assertGreaterEqual(len(rows), 1)
        self.assertTrue(any(r.get("model_id") for r in rows))

    @patch("app.agent_api.parse_che168_detail", side_effect=AssertionError("detail must not be opened"))
    @patch("app.agent_api.horsepower_from_carinfo_url", return_value=156)
    @patch("app.agent_api.marketplace_from_detail_url", return_value="che168")
    @patch("app.agent_api.normalize_import_detail_url", side_effect=lambda u: u)
    @patch("app.agent_api.source_listing_id_from_url", return_value="list-200")
    @patch("app.agent_api.parse_che168_listing_cards_many")
    def test_collect_uses_list_fields_not_detail(
        self, mock_cards, *_mocks
    ) -> None:
        series = "https://www.che168.com/china/aodi/aodiq3/s1"
        profile = self.db.get(SearchProfile, self.profile_id)
        profile.criteria = {
            **(profile.criteria or {}),
            "series_urls": [{"url": series, "brand_id": self.brand_id, "model_id": self.model_id}],
        }
        self.db.commit()
        mock_cards.return_value = [
            (
                series,
                [
                    ListingCard(
                        url="https://www.che168.com/dealer/1/200.html",
                        year=2022,
                        price_cny=180000,
                        mileage_km=25000,
                        registration_date="2022-06-01",
                    )
                ],
                None,
            )
        ]
        r = self.client.post(
            "/agent/v1/collect",
            headers=self.headers,
            json={
                "profile_id": self.profile_id,
                "parse_limit": 40,
                "limit_per_series": 20,
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["status"], "ok")
        self.assertGreaterEqual(body["passed"], 1)
        self.assertTrue(body["listings"])
        row = body["listings"][0]
        self.assertEqual(row["year"], 2022)
        self.assertEqual(row["mileage_km"], 25000)
        self.assertEqual(row["horsepower"], 156)
        self.assertIn("карточки не открывали", body["message"].lower())

    def test_fair_series_caps_covers_all_urls(self) -> None:
        from app.agent_api import fair_series_caps, interleave_by_model

        caps = fair_series_caps(31, total_limit=400, per_series_ceiling=30)
        self.assertEqual(len(caps), 31)
        self.assertEqual(sum(caps), 400)
        self.assertTrue(all(12 <= c <= 13 for c in caps))

        tiny = fair_series_caps(5, total_limit=3, per_series_ceiling=30)
        self.assertEqual(tiny, [1, 1, 1, 1, 1])

        class Row:
            def __init__(self, model_id, ident):
                self.model_id = model_id
                self.id = ident

        mixed = [Row("a", 1), Row("a", 2), Row("b", 3), Row("b", 4)]
        names = [r.model_id for r in interleave_by_model(mixed, 4)]
        self.assertEqual(names, ["a", "b", "a", "b"])

    @patch("app.agent_api.marketplace_from_detail_url", return_value="che168")
    @patch("app.agent_api.normalize_import_detail_url", side_effect=lambda u: u)
    @patch(
        "app.agent_api.source_listing_id_from_url",
        side_effect=lambda u: u.rstrip("/").rsplit("/", 1)[-1].replace(".html", ""),
    )
    @patch("app.agent_api.parse_che168_listing_cards_many")
    def test_discover_equal_quota_per_series(self, mock_cards, *_mocks) -> None:
        q3 = self.db.query(CarModel).filter(CarModel.name == "Q3").one()
        extra = CarModel(
            brand_id=self.brand_id,
            name="A4",
            che168_url="https://www.che168.com/series/a4/",
        )
        self.db.add(extra)
        self.db.flush()
        urls = [
            "https://www.che168.com/china/aodi/a6/s1",
            "https://www.che168.com/china/aodi/q3/s1",
            "https://www.che168.com/china/aodi/a4/s1",
        ]
        model_ids = [self.model_id, q3.id, extra.id]
        profile = self.db.get(SearchProfile, self.profile_id)
        profile.criteria = {
            **(profile.criteria or {}),
            "series_urls": [
                {"url": urls[i], "brand_id": self.brand_id, "model_id": model_ids[i]}
                for i in range(3)
            ],
        }
        self.db.commit()

        def fake_scrape(series_urls, max_per_series, **_kwargs):
            self.assertEqual(max_per_series, 2)
            out = []
            for series_url in series_urls:
                cards = [
                    ListingCard(
                        url=f"{series_url.rstrip('/')}/c{i}.html",
                        year=2022,
                        price_cny=150000,
                        mileage_km=20000,
                    )
                    for i in range(5)
                ]
                out.append((series_url, cards, None))
            return out

        mock_cards.side_effect = fake_scrape
        r = self.client.post(
            "/agent/v1/discover",
            headers=self.headers,
            json={
                "profile_id": self.profile_id,
                "use_whitelist": False,
                "limit_per_series": 10,
                "max_created": 6,
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["created"], 6)
        self.assertEqual(body["series_ok"], 3)
        counts: dict[int, int] = {}
        for cand in body["candidates"]:
            counts[cand["model_id"]] = counts.get(cand["model_id"], 0) + 1
        self.assertEqual(sorted(counts.values()), [2, 2, 2])


if __name__ == "__main__":
    unittest.main()
