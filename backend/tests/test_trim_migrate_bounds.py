"""Startup trim migration must stay bounded (prod outage: ~100% CPU on boot)."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from app.trim_catalog import migrate_legacy_trim_specs


class MigrateLegacyTrimSpecsBoundsTests(unittest.TestCase):
    def test_limit_zero_skips_query(self) -> None:
        db = MagicMock()
        self.assertEqual(migrate_legacy_trim_specs(db, limit=0, scan_cap=400), 0)
        db.execute.assert_not_called()

    def test_stops_after_update_limit(self) -> None:
        trim_a = MagicMock()
        trim_a.id = 1
        trim_a.spec_sections = "{}"
        trim_a.spec_json_ru = None
        trim_a.source_spec_json = "[]"
        trim_a.spec_json = None

        trim_b = MagicMock()
        trim_b.id = 2
        trim_b.spec_sections = "{}"
        trim_b.spec_json_ru = None
        trim_b.source_spec_json = "[]"
        trim_b.spec_json = None

        result = MagicMock()
        result.scalars.return_value.yield_per.return_value = [trim_a, trim_b]
        db = MagicMock()
        db.execute.return_value = result

        with patch("app.trim_catalog.parse_trim_spec_document", return_value=None), patch(
            "app.trim_catalog.rebuild_trim_spec_from_source", return_value=True
        ) as rebuild:
            updated = migrate_legacy_trim_specs(db, limit=1, scan_cap=400)

        self.assertEqual(updated, 1)
        self.assertEqual(rebuild.call_count, 1)
        db.commit.assert_called_once()


if __name__ == "__main__":
    unittest.main()
