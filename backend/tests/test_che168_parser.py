import unittest

from app.che168_parser import (
    ParsedCar,
    _chinese_i_che168_url_from_detail_url,
    _dealer_url_from_global_carinfo,
    _dealer_url_from_mobile_che168,
    _detail_fetch_urls,
    _mobile_che168_infoid_from_url,
    _parse_detail_from_html,
    _parse_is_complete,
    _parse_quality_score,
    _playwright_fetch_urls,
    normalize_import_detail_url,
    source_listing_id_from_url,
)

MOBILE_SAMPLE = (
    "https://m.che168.com/cardetail/index?infoid=58721285&pvareaid=108721"
)
MOBILE_WITH_DEALER = (
    "https://m.che168.com/cardetail/index?infoid=58661738&adfromid=30363497&pvareaid=108948"
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

    def test_dealer_url_from_global_carinfo(self):
        self.assertEqual(
            _dealer_url_from_global_carinfo({"infoid": 57982917, "dealeid": 613544}),
            "https://www.che168.com/dealer/613544/57982917.html",
        )

    def test_mobile_adfromid_zero_has_no_dealer_from_query(self):
        url = (
            "https://m.che168.com/cardetail/index?infoid=57982917&adfromid=0"
        )
        self.assertIsNone(_dealer_url_from_mobile_che168(url))

    def test_playwright_urls_include_global_for_mobile(self):
        url = (
            "https://m.che168.com/cardetail/index?infoid=57982917&adfromid=0"
        )
        urls = _playwright_fetch_urls(url)
        self.assertIn("https://global.che168.com/detail/57982917", urls)
        self.assertIn(url, urls)

    def test_mobile_url_without_dealer_keeps_mobile_url(self):
        self.assertEqual(
            normalize_import_detail_url(MOBILE_SAMPLE),
            MOBILE_SAMPLE,
        )

    def test_mobile_url_with_adfromid_normalizes_to_dealer(self):
        self.assertEqual(
            normalize_import_detail_url(MOBILE_WITH_DEALER),
            "https://www.che168.com/dealer/30363497/58661738.html",
        )

    def test_dealer_url_from_mobile_adfromid(self):
        self.assertEqual(
            _dealer_url_from_mobile_che168(MOBILE_WITH_DEALER),
            "https://www.che168.com/dealer/30363497/58661738.html",
        )

    def test_mobile_url_source_listing_id(self):
        self.assertEqual(source_listing_id_from_url(MOBILE_SAMPLE), "58721285")
        self.assertEqual(source_listing_id_from_url(MOBILE_WITH_DEALER), "58661738")
        normalized = normalize_import_detail_url(MOBILE_WITH_DEALER)
        self.assertEqual(
            source_listing_id_from_url(normalized),
            "dealer-30363497-58661738",
        )

    def test_chinese_url_from_mobile(self):
        self.assertEqual(
            _chinese_i_che168_url_from_detail_url(MOBILE_SAMPLE),
            "https://i.che168.com/car/58721285",
        )

    def test_detail_fetch_urls_from_mobile_with_dealer_first(self):
        urls = _detail_fetch_urls(MOBILE_WITH_DEALER)
        self.assertEqual(urls[0], "https://www.che168.com/dealer/30363497/58661738.html")

    def test_detail_fetch_urls_from_mobile_without_dealer_keeps_mobile(self):
        urls = _detail_fetch_urls(MOBILE_SAMPLE)
        self.assertEqual(urls[0], MOBILE_SAMPLE)
        self.assertIn("https://i.che168.com/car/58721285", urls)

    def test_playwright_urls_skip_global_for_mobile(self):
        urls = _playwright_fetch_urls(MOBILE_WITH_DEALER)
        self.assertTrue(all("global.che168.com" not in u for u in urls))
        self.assertEqual(urls[0], "https://www.che168.com/dealer/30363497/58661738.html")

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


class EngineVolumeParseTests(unittest.TestCase):
    def test_320li_does_not_parse_as_20l(self):
        from app.che168_parser import _parse_engine_volume_cc

        self.assertIsNone(_parse_engine_volume_cc("宝马320Li 2023款 sDrive20Li"))
        self.assertEqual(_parse_engine_volume_cc("2.0T 156 hp"), 2000)
        self.assertEqual(_parse_engine_volume_cc("1.6L 自动"), 1600)

    def test_normalize_fixes_10x_parser_bug(self):
        from app.engine_volume_util import normalize_passenger_engine_volume_cc

        self.assertEqual(normalize_passenger_engine_volume_cc(20000), 2000)
        self.assertEqual(normalize_passenger_engine_volume_cc(2000), 2000)


class ListingCopyRuTests(unittest.TestCase):
    def test_global_seo_title_rejected(self):
        from app.listing_copy_ru import pick_listing_title, title_looks_like_global_seo_english

        seo = (
            "Used Mercedes-Benz Mercedes-Benz A-Class 2022 A 180 L Sport Sedan - "
            "Mercedes-Benz Mercedes-Benz A-Class 5-Seater for Sale - Cheap Price Near Me"
        )
        self.assertTrue(title_looks_like_global_seo_english(seo))
        self.assertEqual(
            pick_listing_title("Mercedes-Benz", "A", 2022, seo),
            "Mercedes-Benz A 2022",
        )

    def test_keeps_english_title_without_russian_translation(self):
        from app.listing_copy_ru import pick_listing_title

        raw = "BMW X5 xDrive40i M Sport"
        self.assertEqual(
            pick_listing_title("BMW", "X5", 2021, raw, translated="БМВ Х5 хДрайв40и М Спорт"),
            raw,
        )

    def test_strips_chinese_from_mixed_title(self):
        from app.listing_copy_ru import pick_listing_title

        raw = "马自达CX-5 2021款 2.0L 自动两驱智慧型"
        self.assertEqual(pick_listing_title("Mazda", "CX-5", 2021, raw), "CX-5 2021 2.0L")
        raw2 = "宝马X1 2023款 sDrive20Li X设计套装"
        self.assertEqual(pick_listing_title("BMW", "X1", 2023, raw2), "X1 2023 sDrive20Li X")


if __name__ == "__main__":
    unittest.main()
