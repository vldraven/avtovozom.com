import unittest

from app.che168_parser import (
    ParsedCar,
    _chinese_i_che168_url_from_detail_url,
    _detail_fetch_urls,
    _mobile_che168_infoid_from_url,
    _parse_detail_from_html,
    _parse_is_complete,
    _parse_quality_score,
    normalize_import_detail_url,
    source_listing_id_from_url,
)

MOBILE_SAMPLE = (
    "https://m.che168.com/cardetail/index?infoid=58721285&pvareaid=108721"
)


class Che168ParserCompletenessTests(unittest.TestCase):
    def test_chinese_url_from_global(self):
        url = "https://global.che168.com/detail/12345"
        self.assertEqual(
            _chinese_i_che168_url_from_detail_url(url),
            "https://i.che168.com/car/12345",
        )

    def test_detail_fetch_urls_prefers_chinese(self):
        urls = _detail_fetch_urls("https://global.che168.com/detail/99")
        self.assertEqual(urls[0], "https://i.che168.com/car/99")

    def test_mobile_url_infoid_extraction(self):
        self.assertEqual(_mobile_che168_infoid_from_url(MOBILE_SAMPLE), "58721285")

    def test_mobile_url_normalizes_to_i_che168(self):
        self.assertEqual(
            normalize_import_detail_url(MOBILE_SAMPLE),
            "https://i.che168.com/car/58721285",
        )

    def test_mobile_url_source_listing_id(self):
        self.assertEqual(source_listing_id_from_url(MOBILE_SAMPLE), "58721285")

    def test_chinese_url_from_mobile(self):
        self.assertEqual(
            _chinese_i_che168_url_from_detail_url(MOBILE_SAMPLE),
            "https://i.che168.com/car/58721285",
        )

    def test_detail_fetch_urls_from_mobile_prefers_i_che168(self):
        urls = _detail_fetch_urls(MOBILE_SAMPLE)
        self.assertEqual(urls[0], "https://i.che168.com/car/58721285")
        self.assertNotIn(MOBILE_SAMPLE, urls)

    def test_parse_is_complete_requires_price(self):
        self.assertFalse(_parse_is_complete(ParsedCar(source_listing_id="global-1", title="Used Car")))
        self.assertFalse(
            _parse_is_complete(
                ParsedCar(
                    source_listing_id="global-1",
                    title="Used Car",
                    photos=["https://example.com/a.jpg"],
                )
            )
        )
        self.assertTrue(
            _parse_is_complete(
                ParsedCar(source_listing_id="global-1", price_cny=125000.0)
            )
        )

    def test_quality_score_prefers_rich_card(self):
        sparse = ParsedCar(source_listing_id="1", title="Only title")
        rich = ParsedCar(
            source_listing_id="1",
            price_cny=89000.0,
            mileage_km=42000,
            registration_date="2021-03-01",
            autohome_spec_id=999,
        )
        self.assertGreater(_parse_quality_score(rich), _parse_quality_score(sparse))

    def test_english_global_html_is_incomplete(self):
        html = """
        <html><head><title>Used Geely Binyue 2021 1.4T</title></head>
        <body><h1>Used Geely Binyue 2021 1.4T DCT Diamond Edition</h1>
        <img data-original="//img.che168.com/photo/1.jpg"/>
        Engine 1.4T 141 hp Automatic White</body></html>
        """
        parsed = _parse_detail_from_html(html, "global-167")
        self.assertIsNotNone(parsed)
        self.assertFalse(_parse_is_complete(parsed))


if __name__ == "__main__":
    unittest.main()
