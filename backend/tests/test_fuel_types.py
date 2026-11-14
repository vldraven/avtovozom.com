import json
import unittest

from app.che168_parser import _parse_fuel_transmission_city
from app.fuel_types import (
    drive_type_from_trim_source_json,
    fuel_from_trim_source_json,
    horsepower_from_trim_source_json,
    normalize_fuel_type_ru,
)


class FuelTypeNormalizeTests(unittest.TestCase):
    def test_canonical_passthrough(self) -> None:
        self.assertEqual(normalize_fuel_type_ru("Бензин"), "бензин")
        self.assertEqual(normalize_fuel_type_ru("дизель"), "дизель")

    def test_chinese_tokens(self) -> None:
        self.assertEqual(normalize_fuel_type_ru("汽油"), "бензин")
        self.assertEqual(normalize_fuel_type_ru("柴油"), "дизель")
        self.assertEqual(normalize_fuel_type_ru("插电式混合动力"), "гибрид")
        self.assertEqual(normalize_fuel_type_ru("增程"), "гибрид")
        self.assertEqual(normalize_fuel_type_ru("纯电动"), "электро")

    def test_hybrid_wins_over_electric_words(self) -> None:
        self.assertEqual(normalize_fuel_type_ru("plug-in hybrid electric"), "гибрид")

    def test_empty(self) -> None:
        self.assertIsNone(normalize_fuel_type_ru(None))
        self.assertIsNone(normalize_fuel_type_ru("расход 6.5"))

    def test_from_autohome_sections(self) -> None:
        raw = json.dumps(
            [
                {
                    "group": "基本参数",
                    "kind": "param",
                    "items": [
                        {"name": "能源类型", "value": "汽油"},
                        {"name": "发动机", "value": "2.0T"},
                        {"name": "最大马力", "value": "169Ps"},
                        {"name": "驱动方式", "value": "前置前驱"},
                    ],
                }
            ],
            ensure_ascii=False,
        )
        self.assertEqual(fuel_from_trim_source_json(raw), "бензин")
        self.assertEqual(horsepower_from_trim_source_json(raw), 169)
        self.assertEqual(drive_type_from_trim_source_json(raw), "Передний")


class FuelParseFromListingTextTests(unittest.TestCase):
    def test_label_and_token(self) -> None:
        fuel, _, _ = _parse_fuel_transmission_city("能源类型：汽油 变速箱 自动")
        self.assertEqual(fuel, "汽油")
        fuel, _, _ = _parse_fuel_transmission_city("表显里程 2万 纯电动 续航")
        self.assertEqual(fuel, "纯电动")
        fuel, _, _ = _parse_fuel_transmission_city("2023款 2.0T 汽油 自动")
        self.assertEqual(fuel, "汽油")
