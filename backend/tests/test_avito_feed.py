import unittest
from types import SimpleNamespace

from app.avito_feed import AvitoComposeOverrides, build_ad_context, render_ad_xml, render_feed_xml


class AvitoFeedTests(unittest.TestCase):
    def _car(self) -> SimpleNamespace:
        brand = SimpleNamespace(name="Toyota")
        model = SimpleNamespace(name="Camry")
        return SimpleNamespace(
            id=42,
            brand=brand,
            model=model,
            year=2022,
            mileage_km=15000,
            engine_volume_cc=2500,
            horsepower=200,
            fuel_type="бензин",
            transmission="автомат",
            body_color_slug="white",
            description="Тестовое описание",
            photos=[],
        )

    def test_render_ad_xml_contains_required_fields(self) -> None:
        car = self._car()
        ctx = build_ad_context(
            car,
            db=None,
            canonical_web_url="https://avtovozom.com/catalog/toyota/camry/42",
            estimated_total_rub=3_500_000.0,
            overrides=AvitoComposeOverrides(
                description="Описание для Avito",
                region="Москва",
                car_type="С пробегом",
                body_type="Седан",
                drive_type="Передний",
                contact_phone="+7 900 000-00-00",
                make="Toyota",
                model="Camry",
                photo_urls=["https://api.avtovozom.com/media/test.jpg"],
            ),
        )
        xml = render_ad_xml(ctx)
        self.assertIn("<Id>avtovozom-42</Id>", xml)
        self.assertIn("<Category>Автомобили</Category>", xml)
        self.assertIn("<Make>Toyota</Make>", xml)
        self.assertIn("<Model>Camry</Model>", xml)
        self.assertIn("<Price>3500000</Price>", xml)
        self.assertIn("<Kilometrage>15000</Kilometrage>", xml)
        self.assertIn("https://api.avtovozom.com/media/test.jpg", xml)

    def test_render_feed_xml_wraps_ads(self) -> None:
        ad = render_ad_xml(
            {
                "feed_ad_id": "avtovozom-1",
                "car_type": "С пробегом",
                "price_rub": 1000000,
                "description": "x",
                "region": "Москва",
                "contact_phone": "+7 900",
                "make": "BMW",
                "model": "X5",
                "year": 2020,
                "body_type": "Внедорожник",
                "drive_type": "Полный",
                "deactivated": False,
            }
        )
        feed = render_feed_xml([ad])
        self.assertTrue(feed.startswith('<?xml version="1.0" encoding="UTF-8"?>'))
        self.assertIn("<Ads>", feed)
        self.assertIn("</Ads>", feed)
        self.assertIn("<Make>BMW</Make>", feed)


if __name__ == "__main__":
    unittest.main()
