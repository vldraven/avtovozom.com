import unittest

from app.trim_display import (
    classify_trim_value,
    filter_param_sections_for_card,
    filter_trim_sections_for_ui,
    format_trim_item_for_ui,
    prepare_param_sections_from_zh,
    prepare_trim_sections_from_zh,
    translate_group_zh,
    translate_item_zh,
)


class TrimDisplayTests(unittest.TestCase):
    def test_classify_markers(self) -> None:
        self.assertEqual(classify_trim_value("●"), "included")
        self.assertEqual(classify_trim_value("○"), "optional")
        self.assertEqual(classify_trim_value("—"), "absent")
        self.assertEqual(classify_trim_value("-/после ●"), "included")

    def test_format_hides_absent(self) -> None:
        self.assertIsNone(format_trim_item_for_ui("ESP", "—"))
        self.assertEqual(format_trim_item_for_ui("ESP", "●"), {"name": "ESP", "value": "●"})

    def test_filter_skips_param_groups(self) -> None:
        sections = [
            {
                "group": "Основные параметры",
                "kind": "param",
                "items": [{"name": "Длина", "value": "4500 мм"}],
            },
            {
                "group": "Безопасность",
                "kind": "config",
                "items": [
                    {"name": "ESP", "value": "●"},
                    {"name": "Подушки", "value": "—"},
                ],
            },
        ]
        out = filter_trim_sections_for_ui(sections)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["group"], "Безопасность")
        self.assertEqual(len(out[0]["items"]), 1)
        self.assertEqual(out[0]["items"][0]["value"], "●")

    def test_param_sections_engine_and_dimensions(self) -> None:
        sections = prepare_param_sections_from_zh(
            [
                {
                    "group": "基本参数",
                    "kind": "param",
                    "items": [
                        {"name": "发动机", "value": "2.0T 156马力 L4"},
                        {"name": "长*宽*高(mm)", "value": "4838*1827*1454"},
                        {"name": "车身结构", "value": "4门5座三厢车"},
                    ],
                },
                {
                    "group": "车身",
                    "kind": "param",
                    "items": [
                        {"name": "(mm)", "value": "4838"},
                        {"name": "(mm)", "value": "1827"},
                        {"name": "(mm)", "value": "1454"},
                        {"name": "(mm)", "value": "2961"},
                    ],
                },
                {
                    "group": "发动机",
                    "kind": "param",
                    "items": [{"name": "发动机型", "value": "B48B20C"}],
                },
            ]
        )
        flat = {it["name"]: it["value"] for sec in sections for it in sec["items"]}
        self.assertIn("Двигатель", flat)
        self.assertIn("156 л.с.", flat["Двигатель"])
        self.assertEqual(flat["Габариты"], "4838 × 1827 × 1454 мм")
        self.assertEqual(flat["Колёсная база, мм"], "2961 мм")
        self.assertEqual(flat["Модель двигателя"], "B48B20C")
        self.assertNotIn("Длина, мм", flat)
        self.assertNotIn("三厢", flat.get("Кузов", ""))

    def test_range_extender_and_liftback_translation(self) -> None:
        sections = prepare_param_sections_from_zh(
            [
                {
                    "group": "基本参数",
                    "kind": "param",
                    "items": [
                        {"name": "发动机", "value": "增程器 95马力"},
                        {"name": "车身结构", "value": "5门5座掀背车"},
                    ],
                },
            ]
        )
        flat = {it["name"]: it["value"] for sec in sections for it in sec["items"]}
        self.assertIn("расширенный диапазон", flat["Двигатель"].lower())
        self.assertIn("95 л.с.", flat["Двигатель"])
        self.assertIn("лифтбек", flat["Кузов"].lower())
        self.assertNotRegex(flat["Двигатель"], r"[\u4e00-\u9fff]")
        self.assertNotRegex(flat["Кузов"], r"[\u4e00-\u9fff]")

    def test_sanitize_stored_param_sections_with_cjk(self) -> None:
        stored = [
            {
                "group": "Технические параметры",
                "items": [
                    {"name": "Двигатель", "value": "增程器 95 л.с."},
                    {"name": "Кузов", "value": "5 дв., 5 мест, 掀背车"},
                ],
            }
        ]
        out = filter_param_sections_for_card(stored)
        flat = {it["name"]: it["value"] for sec in out for it in sec["items"]}
        self.assertEqual(flat["Двигатель"], "расширенный диапазон 95 л.с.")
        self.assertEqual(flat["Кузов"], "5 дв., 5 мест, лифтбек")

    def test_label_fixes(self) -> None:
        row = format_trim_item_for_ui("Аппаратное обеспечение", "●")
        self.assertIsNotNone(row)
        assert row is not None
        self.assertEqual(row["name"], "Камеры и парктроники")

    def test_steering_group_from_zh(self) -> None:
        from app.trim_config_ui import prepare_config_sections_from_zh

        sections = prepare_config_sections_from_zh(
            [
                {
                    "group": "音响/车内灯光",
                    "kind": "config",
                    "items": [
                        {"name": "数量", "value": "6, 10, 16"},
                        {"name": "品牌名称", "value": "Harman/Kardon哈曼卡顿"},
                    ],
                },
                {
                    "group": "硬件",
                    "kind": "config",
                    "items": [{"name": "数量", "value": "1个, 7个"}],
                },
            ]
        )
        flat = {(s["group"], it["name"]): it["value"] for s in sections for it in s["items"]}
        self.assertEqual(flat[("Мультимедиа", "Количество динамиков")], "6, 10, 16")
        self.assertEqual(flat[("Системы помощи", "Количество камер")], "1, 7")

    def test_safety_and_overview_from_zh(self) -> None:
        from app.trim_config_ui import prepare_config_sections_from_zh

        sections = prepare_config_sections_from_zh(
            [
                {
                    "group": "安全",
                    "kind": "config",
                    "items": [
                        {"name": "ABS防抱死", "value": "●"},
                        {"name": "ISOFIX", "value": "●"},
                    ],
                },
                {
                    "group": "基本参数",
                    "kind": "param",
                    "items": [
                        {"name": "变速箱", "value": "8挡手自一体"},
                        {"name": "发动机", "value": "2.0T 156马力 L4"},
                    ],
                },
            ]
        )
        groups = {s["group"] for s in sections}
        self.assertIn("Основное", groups)
        self.assertIn("Безопасность", groups)
        safety = next(s for s in sections if s["group"] == "Безопасность")
        self.assertGreaterEqual(len(safety["items"]), 2)


if __name__ == "__main__":
    unittest.main()
