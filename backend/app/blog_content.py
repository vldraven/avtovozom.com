"""Правила текста блога и переходов статуса. Без доступа к базе."""

from __future__ import annotations

import re
from urllib.parse import urlparse

from .catalog_slug import slugify_label

STAFF_ROLES = frozenset({"admin", "moderator"})
POST_STATUSES = frozenset({"draft", "pending", "published", "rejected"})
RESERVED_SLUGS = frozenset({"write", "authors", "sections", "editor", "tags", "new"})

MAX_BLOCKS = 80
MAX_INLINE = 40
MAX_TABLE_ROWS = 30
MAX_TABLE_COLS = 8
MAX_TAGS = 8
SEO_DESCRIPTION_MAX = 160


class BlogError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def is_staff_role(role: str | None) -> bool:
    return (role or "") in STAFF_ROLES


def clean_slug(raw: str, *, fallback: str = "post") -> str:
    slug = slugify_label(raw or "")
    if slug in RESERVED_SLUGS or slug == "x":
        slug = fallback
    return slug[:90]


def apply_transition(status: str, role: str | None, action: str) -> str:
    """Возвращает новый статус или поднимает BlogError."""
    staff = is_staff_role(role)
    current = status or "draft"
    if current not in POST_STATUSES:
        raise BlogError("Неизвестный статус публикации.")

    if action == "save":
        if current == "published" and not staff:
            return "pending"
        if current == "rejected":
            return "draft"
        return current

    if action == "submit":
        if current not in ("draft", "rejected"):
            raise BlogError("На проверку можно отправить черновик или отклонённую публикацию.")
        return "pending"

    if action == "publish":
        if not staff:
            raise BlogError("Опубликовать сразу может только редакция.")
        if current == "rejected":
            raise BlogError("Отклонённую публикацию сначала нужно исправить.")
        return "published"

    if action == "withdraw":
        if current != "pending":
            raise BlogError("Отозвать можно только публикацию на проверке.")
        return "draft"

    if action == "approve":
        if not staff:
            raise BlogError("Недостаточно прав.")
        if current != "pending":
            raise BlogError("Одобрить можно только публикацию на проверке.")
        return "published"

    if action == "reject":
        if not staff:
            raise BlogError("Недостаточно прав.")
        if current != "pending":
            raise BlogError("Отклонить можно только публикацию на проверке.")
        return "rejected"

    raise BlogError("Неизвестное действие.")


def validate_ready_to_publish(*, title: str, section_id: int | None, cover_url: str, body: list) -> None:
    if len((title or "").strip()) < 8:
        raise BlogError("Заголовок должен быть не короче 8 символов.")
    if not section_id:
        raise BlogError("Выберите раздел.")
    if not (cover_url or "").startswith("/media/blog/"):
        raise BlogError("Добавьте обложку.")
    if not _body_has_text(body):
        raise BlogError("Добавьте текст публикации.")


def _body_has_text(body: list) -> bool:
    for block in body or []:
        if not isinstance(block, dict):
            continue
        kind = block.get("type")
        if kind in ("h2", "h3") and str(block.get("text") or "").strip():
            return True
        if kind == "paragraph":
            for inline in block.get("inlines") or []:
                if isinstance(inline, dict) and str(inline.get("text") or "").strip():
                    return True
        if kind == "list":
            for item in block.get("items") or []:
                for inline in item or []:
                    if isinstance(inline, dict) and str(inline.get("text") or "").strip():
                        return True
        if kind == "table":
            for row in block.get("rows") or []:
                for cell in row or []:
                    if str(cell or "").strip():
                        return True
    return False


def _clean_text(value: object, limit: int) -> str:
    text = str(value or "").replace("\x00", "")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text[:limit]


def _clean_href(value: object) -> str | None:
    href = str(value or "").strip()
    if not href or len(href) > 500:
        return None
    if href.startswith("/") and not href.startswith("//") and "\\" not in href:
        return href
    parsed = urlparse(href)
    if parsed.scheme in ("http", "https") and parsed.netloc:
        return href
    return None


def normalize_blocks(raw: object) -> list[dict]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise BlogError("Текст публикации должен быть списком блоков.")
    if len(raw) > MAX_BLOCKS:
        raise BlogError(f"Не больше {MAX_BLOCKS} блоков в публикации.")
    out: list[dict] = []
    for item in raw:
        block = _normalize_block(item)
        if block:
            out.append(block)
    return out


def _normalize_block(item: object) -> dict | None:
    if not isinstance(item, dict):
        return None
    kind = str(item.get("type") or "")
    if kind == "paragraph":
        inlines = _normalize_inlines(item.get("inlines"))
        if not inlines:
            return None
        return {"type": "paragraph", "inlines": inlines}
    if kind in ("h2", "h3"):
        text = _clean_text(item.get("text"), 240)
        if not text:
            return None
        return {"type": kind, "text": text}
    if kind == "list":
        ordered = bool(item.get("ordered"))
        items: list[list[dict]] = []
        for raw_item in (item.get("items") or [])[:40]:
            inlines = _normalize_inlines(raw_item)
            if inlines:
                items.append(inlines)
        if not items:
            return None
        return {"type": "list", "ordered": ordered, "items": items}
    if kind == "image":
        url = str(item.get("url") or "").strip()
        if not url.startswith("/media/blog/") or ".." in url:
            raise BlogError("Фото в тексте должно быть загружено на сайт.")
        alt = _clean_text(item.get("alt"), 180)
        return {"type": "image", "url": url[:512], "alt": alt}
    if kind == "table":
        rows = _normalize_table(item.get("rows"))
        if not rows:
            return None
        caption = _clean_text(item.get("caption"), 180)
        block = {"type": "table", "rows": rows}
        if caption:
            block["caption"] = caption
        return block
    raise BlogError("Неизвестный блок текста.")


def _normalize_inlines(raw: object) -> list[dict]:
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    for item in raw[:MAX_INLINE]:
        if not isinstance(item, dict):
            continue
        text = _clean_text(item.get("text"), 4000)
        if not text:
            continue
        inline: dict = {"text": text}
        href = _clean_href(item.get("href"))
        if href:
            inline["href"] = href
        if item.get("bold") is True:
            inline["bold"] = True
        if item.get("italic") is True:
            inline["italic"] = True
        out.append(inline)
    return out


def _normalize_table(raw: object) -> list[list[str]]:
    if not isinstance(raw, list):
        return []
    rows: list[list[str]] = []
    width = 0
    for row in raw[:MAX_TABLE_ROWS]:
        if not isinstance(row, list):
            continue
        cells = [_clean_text(cell, 200) for cell in row[:MAX_TABLE_COLS]]
        width = max(width, len(cells))
        rows.append(cells)
    if width == 0:
        return []
    return [row + [""] * (width - len(row)) for row in rows]


def normalize_tag_names(raw: object) -> list[str]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise BlogError("Теги должны быть списком.")
    names: list[str] = []
    seen: set[str] = set()
    for item in raw:
        name = _clean_text(item, 32)
        if not name:
            continue
        key = name.casefold()
        if key in seen:
            continue
        seen.add(key)
        names.append(name)
        if len(names) >= MAX_TAGS:
            break
    return names
