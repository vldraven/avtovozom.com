"""Тесты resize локальных /media с дисковым кэшем."""

from __future__ import annotations

import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from app.media_resize import (
    ALLOWED_WIDTHS,
    cache_path_for,
    resize_local_image,
    resolve_local_media_path,
)


def _make_jpeg(path: Path, size=(1024, 768), color=(40, 120, 200)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im = Image.new("RGB", size, color)
    im.save(path, format="JPEG", quality=90)


class MediaResizeTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.root = Path(self._tmpdir.name)
        self._env = patch.dict(os.environ, {"MEDIA_ROOT": str(self.root)})
        self._env.start()

    def tearDown(self):
        self._env.stop()
        self._tmpdir.cleanup()

    def test_resolve_rejects_traversal_and_external(self):
        self.assertIsNone(resolve_local_media_path("https://cdn.example/a.jpg"))
        self.assertIsNone(resolve_local_media_path("/media/../etc/passwd"))
        self.assertIsNone(resolve_local_media_path("/media/.cache/w640/x.jpg"))

    def test_resolve_existing_file(self):
        src = self.root / "cars" / "1" / "0.jpg"
        _make_jpeg(src)
        got = resolve_local_media_path("/media/cars/1/0.jpg")
        self.assertEqual(got, src.resolve())

    def test_resize_writes_cache_and_shrinks(self):
        src = self.root / "cars" / "9" / "0.jpg"
        _make_jpeg(src, size=(1024, 768))
        original_size = src.stat().st_size
        body, ct = resize_local_image(src, 640)
        self.assertEqual(ct, "image/jpeg")
        self.assertLess(len(body), original_size)
        cached = cache_path_for(src, 640)
        self.assertTrue(cached.is_file())
        with Image.open(io.BytesIO(body)) as im:
            self.assertEqual(im.size[0], 640)
            self.assertEqual(im.size[1], 480)

        # second call hits cache
        mtime = cached.stat().st_mtime
        body2, _ = resize_local_image(src, 640)
        self.assertEqual(body2, body)
        self.assertEqual(cached.stat().st_mtime, mtime)

    def test_allowed_widths(self):
        self.assertIn(640, ALLOWED_WIDTHS)
        src = self.root / "cars" / "2" / "0.jpg"
        _make_jpeg(src)
        with self.assertRaises(ValueError):
            resize_local_image(src, 777)


if __name__ == "__main__":
    unittest.main()
