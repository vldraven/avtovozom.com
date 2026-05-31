import json
import unittest
from pathlib import Path

from app.autohome_config import (
    build_spec_fingerprint,
    extract_autohome_spec_id,
    parse_spec_config_payload,
)
from app.trim_catalog import normalize_spec_heading, normalize_trim_sections_for_display

FIXTURE = Path(__file__).parent / "fixtures" / "autohome_spec_sample.json"


class AutohomeConfigTests(unittest.TestCase):
    def test_extract_spec_id_from_html(self) -> None:
        html = '<input type="hidden" id="car_specid" value="52569" />'
        self.assertEqual(extract_autohome_spec_id(html), 52569)

    def test_extract_spec_id_reversed_attrs(self) -> None:
        html = '<input value="12345" id="car_specid" type="hidden" />'
        self.assertEqual(extract_autohome_spec_id(html), 12345)

    def test_parse_sample_payload(self) -> None:
        outer = json.loads(FIXTURE.read_text(encoding="utf-8"))
        parsed = parse_spec_config_payload(outer, autohome_spec_id=52569)
        self.assertEqual(parsed.autohome_spec_id, 52569)
        self.assertIn("缤越", parsed.name_zh)
        self.assertGreaterEqual(len(parsed.sections), 2)
        self.assertTrue(parsed.fingerprint)
        self.assertEqual(parsed.fingerprint, build_spec_fingerprint(parsed.sections))

        groups = {s["group"] for s in parsed.sections}
        self.assertIn("基本参数", groups)
        self.assertIn("安全配置", groups)

        safety = next(s for s in parsed.sections if s["group"] == "安全配置")
        vals = {it["name"]: it["value"] for it in safety["items"]}
        self.assertEqual(vals.get("主/副驾驶座安全气囊"), "●")
        self.assertEqual(vals.get("并线辅助"), "○")


    def test_normalize_spec_heading(self) -> None:
        self.assertEqual(normalize_spec_heading("  основные/параметры  "), "Основные параметры")
        self.assertEqual(normalize_spec_heading("主/副驾驶座安全气囊"), "主 副驾驶座安全气囊")
        self.assertEqual(
            normalize_trim_sections_for_display(
                [{"group": "安全/配置", "items": [{"name": "并线·辅助", "value": "●"}]}]
            ),
            [{"group": "安全 配置", "items": [{"name": "并线 辅助", "value": "●"}]}],
        )


if __name__ == "__main__":
    unittest.main()
