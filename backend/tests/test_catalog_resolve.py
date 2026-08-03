"""Unit tests for che168 → catalog brand/model resolve."""

from __future__ import annotations

import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.catalog_resolve import (
    resolve_catalog,
    resolve_from_series_url,
    resolve_from_text,
    series_path_slugs,
)
from app.db import Base
from app.models import CarBrand, CarModel


class CatalogResolveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        audi = CarBrand(name="Audi")
        bmw = CarBrand(name="BMW")
        toyota = CarBrand(name="Toyota")
        self.db.add_all([audi, bmw, toyota])
        self.db.flush()
        self.db.add_all(
            [
                CarModel(brand_id=audi.id, name="Q3"),
                CarModel(brand_id=audi.id, name="A3"),
                CarModel(brand_id=audi.id, name="Q2"),
                CarModel(brand_id=bmw.id, name="3 Series"),
                CarModel(brand_id=toyota.id, name="Corolla"),
            ]
        )
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()

    def test_series_path_slugs(self) -> None:
        b, m = series_path_slugs(
            "https://www.che168.com/china/aodi/aodiq3/s53586-53586/"
        )
        self.assertEqual(b, "aodi")
        self.assertEqual(m, "aodiq3")
        b2, m2 = series_path_slugs(
            "https://www.che168.com/china/jiliqiche/a3_5msdgscncgpi1ltocsp1ex/"
        )
        self.assertEqual(b2, "jiliqiche")
        self.assertIsNone(m2)

    def test_resolve_from_series_url(self) -> None:
        ref = resolve_from_series_url(
            self.db,
            "https://www.che168.com/china/aodi/aodiq3/a3_5msdgscncgpi1ltocspexx0/",
        )
        self.assertTrue(ref.ok)
        self.assertEqual(ref.brand_name, "Audi")
        self.assertEqual(ref.model_name, "Q3")

        ref2 = resolve_from_series_url(
            self.db,
            "https://www.che168.com/china/baoma/baoma3xi/s57178/",
        )
        self.assertTrue(ref2.ok)
        self.assertEqual(ref2.brand_name, "BMW")
        self.assertEqual(ref2.model_name, "3 Series")

        ref3 = resolve_from_series_url(
            self.db,
            "https://www.che168.com/china/fengtian/kaluola/a3_5msdg/",
        )
        self.assertTrue(ref3.ok)
        self.assertEqual(ref3.model_name, "Corolla")

    def test_resolve_from_chinese_title(self) -> None:
        ref = resolve_from_text(self.db, title="【哈尔滨】宝马3系 2021款 325Li")
        self.assertTrue(ref.ok)
        self.assertEqual(ref.brand_name, "BMW")
        self.assertEqual(ref.model_name, "3 Series")

        ref2 = resolve_from_text(self.db, title="奥迪Q3 2020款 35 TFSI")
        self.assertTrue(ref2.ok)
        self.assertEqual(ref2.brand_name, "Audi")
        self.assertEqual(ref2.model_name, "Q3")

    def test_resolve_catalog_combo(self) -> None:
        ref = resolve_catalog(
            self.db,
            series_url="https://www.che168.com/china/aodi/aodia3/",
        )
        self.assertEqual(ref.model_name, "A3")


if __name__ == "__main__":
    unittest.main()
