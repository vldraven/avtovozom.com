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
    @patch(
        "app.agent_api.parse_che168_listing_links",
        return_value=["https://www.che168.com/dealer/1/99.html"],
    )
    def test_discover_and_apply(self, *_mocks) -> None:
        r = self.client.post(
            "/agent/v1/discover",
            headers=self.headers,
            json={
                "profile_id": self.profile_id,
                "series_urls": ["https://www.che168.com/series/test/"],
                "use_whitelist": False,
                "limit_per_series": 10,
            },
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["created"], 1)

        cand_id = r.json()["candidates"][0]["id"]
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
                    }
                ]
            },
        )
        self.assertEqual(score.status_code, 200)

        apply = self.client.post(
            "/agent/v1/apply-to-import-plan",
            headers=self.headers,
            json={"profile_id": self.profile_id, "candidate_ids": [cand_id]},
        )
        self.assertEqual(apply.status_code, 200, apply.text)
        self.assertEqual(apply.json()["applied"], 1)
        self.assertEqual(apply.json()["already_today"], 1)
        self.assertEqual(apply.json()["needed"], 19)

        plan = self.client.get("/agent/v1/import-plan", headers=self.headers)
        self.assertEqual(plan.status_code, 200)
        self.assertGreaterEqual(len(plan.json()["rows"]), 1)


if __name__ == "__main__":
    unittest.main()
