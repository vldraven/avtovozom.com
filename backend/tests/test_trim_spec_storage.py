import json
import unittest

from app.trim_spec_storage import (
    TrimSpecDocument,
    build_trim_spec_from_source_sections,
    empty_trim_spec_document,
    is_rich_trim_spec,
    load_trim_spec_from_row,
    parse_trim_spec_document,
    save_trim_spec_to_row,
)


class _FakeTrim:
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


class TrimSpecStorageTests(unittest.TestCase):
    def test_empty_document(self) -> None:
        doc = empty_trim_spec_document()
        self.assertEqual(json.loads(doc.to_json())["version"], 1)

    def test_parse_legacy_list(self) -> None:
        raw = json.dumps([{"group": "Безопасность", "items": [{"name": "ABS", "value": "●"}]}])
        doc = parse_trim_spec_document(raw)
        assert doc is not None
        self.assertEqual(len(doc.sections), 1)
        self.assertEqual(doc.param_sections, [])

    def test_parse_document(self) -> None:
        raw = json.dumps(
            {
                "version": 1,
                "sections": [{"group": "Основное", "items": [{"name": "КПП", "value": "AT"}]}],
                "param_sections": [{"group": "Технические параметры", "items": [{"name": "Длина", "value": "4 м"}]}],
            }
        )
        doc = parse_trim_spec_document(raw)
        assert doc is not None
        self.assertTrue(is_rich_trim_spec(doc))
        self.assertEqual(doc.sections[0]["group"], "Основное")

    def test_load_from_spec_sections_only(self) -> None:
        doc = TrimSpecDocument(
            sections=[{"group": "Комфорт", "items": [{"name": "Климат", "value": "●"}]}],
            param_sections=[],
        )
        trim = _FakeTrim(spec_sections=doc.to_json(), spec_json="[]", spec_json_ru="[]")
        loaded = load_trim_spec_from_row(trim)
        self.assertEqual(len(loaded.sections), 1)
        self.assertEqual(loaded.sections[0]["items"][0]["name"], "Климат")

    def test_save_to_row(self) -> None:
        trim = _FakeTrim(spec_sections="[]")
        doc = TrimSpecDocument(
            sections=[{"group": "Салон", "items": [{"name": "Кожа", "value": "●"}]}],
            param_sections=[],
        )
        save_trim_spec_to_row(trim, doc)
        parsed = parse_trim_spec_document(trim.spec_sections)
        assert parsed is not None
        self.assertEqual(parsed.sections[0]["group"], "Салон")

    def test_build_from_autohome_sample(self) -> None:
        sections_zh = [
            {
                "group": "安全",
                "kind": "config",
                "items": [{"name": "ABS防抱死", "value": "●"}],
            },
            {
                "group": "基本参数",
                "kind": "param",
                "items": [{"name": "变速箱", "value": "8挡手自一体"}],
            },
        ]
        doc = build_trim_spec_from_source_sections(sections_zh)
        self.assertTrue(doc.sections or doc.param_sections)


if __name__ == "__main__":
    unittest.main()
