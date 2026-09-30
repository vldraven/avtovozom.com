"""Правила текста и статусов блога — без базы."""

from __future__ import annotations

import unittest

from app.blog_content import (
    BlogError,
    apply_transition,
    clean_slug,
    normalize_blocks,
    normalize_tag_names,
    validate_ready_to_publish,
)


class BlogTransitionTests(unittest.TestCase):
    def test_user_submit_and_recheck(self):
        self.assertEqual(apply_transition("draft", "user", "submit"), "pending")
        self.assertEqual(apply_transition("published", "user", "save"), "pending")
        self.assertEqual(apply_transition("published", "admin", "save"), "published")

    def test_staff_publishes_without_queue(self):
        self.assertEqual(apply_transition("draft", "moderator", "publish"), "published")
        with self.assertRaises(BlogError):
            apply_transition("draft", "user", "publish")

    def test_moderation(self):
        self.assertEqual(apply_transition("pending", "admin", "approve"), "published")
        self.assertEqual(apply_transition("pending", "moderator", "reject"), "rejected")
        self.assertEqual(apply_transition("pending", "user", "withdraw"), "draft")
        self.assertEqual(apply_transition("rejected", "user", "save"), "draft")


class BlogBodyTests(unittest.TestCase):
    def test_blocks_and_links(self):
        body = normalize_blocks(
            [
                {"type": "h2", "text": "Как считается"},
                {
                    "type": "paragraph",
                    "inlines": [
                        {"text": "Смотрите "},
                        {"text": "калькулятор", "href": "/customs-calculator", "bold": True},
                        {"text": " и "},
                        {"text": "сайт", "href": "javascript:alert(1)"},
                    ],
                },
                {
                    "type": "table",
                    "caption": "Ставки",
                    "rows": [["Объём", "до 3 лет"], ["до 1.0 л", "3 400 ₽"]],
                },
                {"type": "image", "url": "/media/blog/1/cover.jpg", "alt": "Обложка"},
                {
                    "type": "list",
                    "ordered": False,
                    "items": [[{"text": "Масло"}], [{"text": "Фильтр", "italic": True}]],
                },
            ]
        )
        self.assertEqual(body[1]["inlines"][1]["href"], "/customs-calculator")
        self.assertNotIn("href", body[1]["inlines"][3])
        self.assertTrue(body[1]["inlines"][1].get("bold"))
        self.assertEqual(len(body[2]["rows"][0]), 2)
        self.assertFalse(body[4]["ordered"])
        self.assertEqual(body[4]["items"][0][0]["text"], "Масло")
        with self.assertRaises(BlogError):
            normalize_blocks([{"type": "image", "url": "https://evil.test/a.jpg"}])

    def test_tags_and_slug(self):
        self.assertEqual(normalize_tag_names(["Гибриды", "гибриды", "Li Auto"]), ["Гибриды", "Li Auto"])
        self.assertEqual(clean_slug("Утильсбор 2026"), "utilsbor-2026")
        self.assertNotEqual(clean_slug("write"), "write")

    def test_ready(self):
        body = [{"type": "paragraph", "inlines": [{"text": "Текст публикации."}]}]
        validate_ready_to_publish(
            title="Новые ставки утильсбора",
            section_id=1,
            cover_url="/media/blog/1/a.jpg",
            body=body,
        )
        with self.assertRaises(BlogError):
            validate_ready_to_publish(title="Коротко", section_id=1, cover_url="/media/blog/1/a.jpg", body=body)


if __name__ == "__main__":
    unittest.main()
