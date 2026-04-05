"""Перевод китайского текста в русский для полей объявлений."""

from __future__ import annotations

import re

_CHUNK = 4500


def translate_to_ru(text: str | None) -> str | None:
    if not text or not str(text).strip():
        return text
    s = str(text).strip()
    if not re.search(r"[\u4e00-\u9fff]", s):
        return s
    try:
        from deep_translator import GoogleTranslator

        t = GoogleTranslator(source="zh-CN", target="ru")
        parts: list[str] = []
        for i in range(0, len(s), _CHUNK):
            parts.append(t.translate(s[i : i + _CHUNK]) or "")
        return " ".join(p for p in parts if p).strip() or s
    except Exception:
        return s
