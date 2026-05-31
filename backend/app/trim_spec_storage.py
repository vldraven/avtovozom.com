"""Каноническое хранение комплектации на русском (независимо от источника импорта)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

SPEC_VERSION = 1

# Группы Autohome без поля kind (legacy import)
AUTOHOME_PARAM_GROUPS = frozenset(
    {"基本参数", "车身", "发动机", "变速箱", "底盘转向", "车轮制动"}
)


def infer_section_kind(sec: dict[str, Any]) -> str:
    """param vs config: по kind или по названию группы."""
    kind = sec.get("kind")
    if kind in ("param", "config"):
        return str(kind)
    group = str(sec.get("group") or "").strip()
    if group in AUTOHOME_PARAM_GROUPS:
        return "param"
    return "config"


@dataclass
class TrimSpecDocument:
    sections: list[dict[str, Any]]
    param_sections: list[dict[str, Any]]
    version: int = SPEC_VERSION

    def to_json(self) -> str:
        return json.dumps(
            {
                "version": self.version,
                "sections": self.sections,
                "param_sections": self.param_sections,
            },
            ensure_ascii=False,
        )

    @property
    def is_empty(self) -> bool:
        return not self.sections and not self.param_sections


def empty_trim_spec_document() -> TrimSpecDocument:
    return TrimSpecDocument(sections=[], param_sections=[])


def _normalize_section_list(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for sec in raw:
        if not isinstance(sec, dict):
            continue
        group = str(sec.get("group") or "").strip()
        items_raw = sec.get("items")
        if not group or not isinstance(items_raw, list):
            continue
        items: list[dict[str, str]] = []
        for it in items_raw:
            if not isinstance(it, dict):
                continue
            name = str(it.get("name") or "").strip()
            value = str(it.get("value") or "").strip()
            if name and value:
                items.append({"name": name, "value": value})
        if items:
            out.append({"group": group, "items": items})
    return out


def parse_trim_spec_document(raw: str | None) -> TrimSpecDocument | None:
    if not raw or not str(raw).strip():
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if isinstance(data, dict):
        if "sections" in data or "param_sections" in data:
            return TrimSpecDocument(
                version=int(data.get("version") or SPEC_VERSION),
                sections=_normalize_section_list(data.get("sections")),
                param_sections=_normalize_section_list(data.get("param_sections")),
            )
        return None
    if isinstance(data, list):
        # Legacy: spec_json_ru — только секции комплектации без param_sections.
        return TrimSpecDocument(sections=_normalize_section_list(data), param_sections=[])
    return None


def is_rich_trim_spec(doc: TrimSpecDocument | None) -> bool:
    if doc is None or doc.is_empty:
        return False
    config_items = sum(len(s.get("items") or []) for s in doc.sections)
    param_items = sum(len(s.get("items") or []) for s in doc.param_sections)
    non_overview_items = sum(
        len(s.get("items") or [])
        for s in doc.sections
        if str(s.get("group") or "") != "Основное"
    )
    # Только блок «Основное» — неполная комплектация (legacy без kind).
    if non_overview_items < 10:
        return False
    return config_items + param_items >= 10


def build_trim_spec_from_source_sections(sections_zh: list[dict[str, Any]]) -> TrimSpecDocument:
    """Импорт Autohome / che168: один раз переводим в русский документ для хранения."""
    from .trim_config_ui import prepare_config_sections_from_zh
    from .trim_display import prepare_param_sections_from_zh

    return TrimSpecDocument(
        sections=prepare_config_sections_from_zh(sections_zh),
        param_sections=prepare_param_sections_from_zh(sections_zh),
    )


def load_trim_spec_from_row(
    trim: Any,
    *,
    allow_rebuild_from_source: bool = False,
) -> TrimSpecDocument:
    """
    Читает канонический русский документ из trim.spec_sections.
    Legacy-поля spec_json_ru / spec_json — только для миграции и rebuild.
    """
    doc: TrimSpecDocument | None = None
    for attr in ("spec_sections", "spec_json_ru"):
        raw = getattr(trim, attr, None)
        parsed = parse_trim_spec_document(raw)
        if parsed and is_rich_trim_spec(parsed):
            return parsed
        if parsed and doc is None:
            doc = parsed

    if allow_rebuild_from_source:
        source_raw = getattr(trim, "source_spec_json", None) or getattr(trim, "spec_json", None)
        if source_raw:
            try:
                sections_zh = json.loads(source_raw)
            except json.JSONDecodeError:
                sections_zh = []
            if isinstance(sections_zh, list) and sections_zh:
                return build_trim_spec_from_source_sections(sections_zh)

    if doc and not doc.is_empty:
        return doc
    return empty_trim_spec_document()


def save_trim_spec_to_row(trim: Any, doc: TrimSpecDocument) -> None:
    trim.spec_sections = doc.to_json()
