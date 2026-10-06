"""Tests for transmission junk filtering (运转良好 etc.)."""

from __future__ import annotations

import unittest

from app.transmission_types import (
    is_junk_transmission,
    normalize_transmission_ru,
    shorten_transmission_display,
    transmission_from_trim_sections,
)


class TransmissionNormalizeTests(unittest.TestCase):
    def test_rejects_condition_phrase(self) -> None:
        self.assertTrue(is_junk_transmission("运转良好"))
        self.assertIsNone(normalize_transmission_ru("运转良好"))
        self.assertIsNone(normalize_transmission_ru("车况良好"))

    def test_rejects_max_speed(self) -> None:
        self.assertTrue(is_junk_transmission("200km/h"))
        self.assertIsNone(normalize_transmission_ru("200km/h"))
        self.assertIsNone(normalize_transmission_ru("200 км/ч"))
        self.assertIsNone(normalize_transmission_ru("最高车速200"))

    def test_maps_known_gearbox(self) -> None:
        self.assertEqual(normalize_transmission_ru("自动"), "Автомат")
        self.assertEqual(normalize_transmission_ru("AT"), "Автомат")
        self.assertEqual(normalize_transmission_ru("7挡湿式双离合"), "Робот DCT")

    def test_shortens_russian_dct(self) -> None:
        raw = "Трансмиссия с двойным сцеплением мокрого типа (DCT)"
        self.assertEqual(normalize_transmission_ru(raw), "Робот DCT")
        self.assertEqual(shorten_transmission_display(raw), "Робот DCT")

    def test_from_trim_prefers_tip_kpp(self) -> None:
        sections = [
            {
                "group": "Коробка передач",
                "items": [
                    {"name": "Коробка передач", "value": "7-ступенчатая мокрая коробка с двойным сцеплением"},
                    {
                        "name": "Тип КПП",
                        "value": "Трансмиссия с двойным сцеплением мокрого типа (DCT)",
                    },
                ],
            }
        ]
        self.assertEqual(transmission_from_trim_sections(sections), "Робот DCT")


if __name__ == "__main__":
    unittest.main()
