"""Tests for server-side import plan helpers."""

from __future__ import annotations

import unittest

from app.import_plan_logic import (
    IMPORT_PLAN_MAX_RETRIES,
    _queueable_items,
    prepare_items_for_fresh_start,
)
from app.models import ImportPlanItem


class ImportPlanLogicTests(unittest.TestCase):
    def _item(self, **kwargs):
        defaults = {
            "id": 1,
            "plan_id": 1,
            "client_key": "a",
            "sort_order": 0,
            "marketplace": "che168",
            "model_id": 10,
            "url": "https://www.che168.com/dealer/1/2.html",
            "status": "pending",
            "attempts": 0,
            "message": "",
        }
        defaults.update(kwargs)
        return ImportPlanItem(**defaults)

    def test_queueable_skips_success_and_exhausted_failed(self):
        items = [
            self._item(id=1, status="success"),
            self._item(id=2, status="failed", attempts=IMPORT_PLAN_MAX_RETRIES),
            self._item(id=3, status="pending", attempts=1),
            self._item(id=4, model_id=None, url="https://x"),
            self._item(id=5, status="failed", attempts=1),
        ]
        q = _queueable_items(items)
        self.assertEqual([i.id for i in q], [3, 5])

    def test_prepare_fresh_start_resets_failed(self):
        items = [
            self._item(id=1, status="success", attempts=1, message="ok"),
            self._item(id=2, status="failed", attempts=3, message="boom"),
            self._item(id=3, status="running", attempts=1, parse_job_id=9),
        ]
        prepare_items_for_fresh_start(items)
        self.assertEqual(items[0].status, "success")
        self.assertEqual(items[1].status, "pending")
        self.assertEqual(items[1].attempts, 0)
        self.assertTrue(items[1].message.startswith("Повтор:"))
        self.assertEqual(items[2].status, "pending")
        self.assertIsNone(items[2].parse_job_id)

    def test_non_retryable_captcha_and_nameerror(self):
        from app.import_plan_logic import _is_non_retryable_import_error

        self.assertTrue(_is_non_retryable_import_error("che168 captcha"))
        self.assertTrue(
            _is_non_retryable_import_error(
                "name 'normalize_passenger_engine_volume_cc' is not defined"
            )
        )
        self.assertTrue(_is_non_retryable_import_error("не найдена цена в юанях"))
        self.assertFalse(_is_non_retryable_import_error("Page.goto: Timeout 120000ms exceeded"))


if __name__ == "__main__":
    unittest.main()
