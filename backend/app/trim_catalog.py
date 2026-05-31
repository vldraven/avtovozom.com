"""Справочник комплектаций: lazy fetch по autohome_spec_id, link на объявление."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .apply_generations_reference import _pick_generation_for_year
from .autohome_config import fetch_spec_config
from .models import CarGeneration, CarTrim
from .trim_display import filter_trim_sections_for_ui, normalize_spec_heading
from .trim_spec_storage import (
    build_trim_spec_from_source_sections,
    is_rich_trim_spec,
    parse_trim_spec_document,
    save_trim_spec_to_row,
)

log = logging.getLogger(__name__)


def normalize_trim_sections_for_display(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for sec in sections:
        if not isinstance(sec, dict):
            continue
        group = normalize_spec_heading(sec.get("group"))
        if not group:
            continue
        kind = sec.get("kind") if isinstance(sec.get("kind"), str) else None
        items: list[dict[str, str]] = []
        for it in sec.get("items") or []:
            if not isinstance(it, dict):
                continue
            name = normalize_spec_heading(it.get("name"))
            if not name:
                continue
            items.append({"name": name, "value": str(it.get("value") or "—")})
        if items:
            payload: dict[str, Any] = {"group": group, "items": items}
            if kind:
                payload["kind"] = kind
            normalized.append(payload)
    return filter_trim_sections_for_ui(normalized)


def normalize_trim_name(name: str | None) -> str:
    s = re.sub(r"[\s\-_/·,，.（）()]", "", (name or "").lower())
    return s[:256]


def pick_generation_id_for_car(db: Session, model_id: int, year: int | None) -> int | None:
    rows = (
        db.execute(select(CarGeneration).where(CarGeneration.model_id == model_id))
        .scalars()
        .all()
    )
    gen = _pick_generation_for_year(year, list(rows))
    return gen.id if gen else None


def _translate_trim_name(name_zh: str | None) -> str:
    from .trim_config_ui import _cached_translate

    raw = (name_zh or "").strip()
    if not raw:
        return ""
    if re.search(r"[\u4e00-\u9fff]", raw):
        tr = _cached_translate(raw)
        return normalize_spec_heading(tr or raw)
    return normalize_spec_heading(raw)


def rebuild_trim_spec_from_source(trim: CarTrim) -> bool:
    """Пересобрать русский spec_sections из source_spec_json (Autohome и др.)."""
    source_raw = trim.source_spec_json or trim.spec_json
    if not source_raw:
        return False
    try:
        sections_src = json.loads(source_raw)
    except json.JSONDecodeError:
        return False
    if not isinstance(sections_src, list) or not sections_src:
        return False
    doc = build_trim_spec_from_source_sections(sections_src)
    if doc.is_empty:
        return False
    save_trim_spec_to_row(trim, doc)
    trim.spec_json_ru = trim.spec_sections
    return True


def migrate_legacy_trim_specs(db: Session) -> int:
    """Неполный spec_sections или legacy без kind → пересборка из source_spec_json."""
    updated = 0
    for trim in db.execute(select(CarTrim)).scalars().all():
        doc = parse_trim_spec_document(trim.spec_sections or trim.spec_json_ru or "")
        if doc and is_rich_trim_spec(doc):
            continue
        if rebuild_trim_spec_from_source(trim):
            updated += 1
    if updated:
        db.commit()
    return updated


def resolve_trim_for_listing(
    db: Session,
    *,
    model_id: int,
    year: int | None,
    autohome_spec_id: int | None,
) -> int | None:
    """
    Lazy: если spec уже в car_trims — только id; иначе один запрос к Autohome API и insert.
    Ошибки не пробрасываются — импорт объявления не блокируется.
    """
    if not autohome_spec_id:
        return None

    existing = db.execute(
        select(CarTrim).where(CarTrim.autohome_spec_id == autohome_spec_id)
    ).scalar_one_or_none()
    if existing:
        return existing.id

    try:
        parsed = fetch_spec_config(autohome_spec_id)
    except Exception as exc:
        log.warning("autohome spec fetch failed spec_id=%s: %s", autohome_spec_id, exc)
        return None

    generation_id = pick_generation_id_for_car(db, model_id, year)

    fp_q = select(CarTrim).where(
        CarTrim.model_id == model_id,
        CarTrim.spec_fingerprint == parsed.fingerprint,
    )
    if generation_id is None:
        fp_q = fp_q.where(CarTrim.generation_id.is_(None))
    else:
        fp_q = fp_q.where(CarTrim.generation_id == generation_id)
    fp_match = db.execute(fp_q).scalar_one_or_none()
    if fp_match:
        return fp_match.id

    name_ru = _translate_trim_name(parsed.name_zh)
    doc = build_trim_spec_from_source_sections(parsed.sections)
    source_json = json.dumps(parsed.sections, ensure_ascii=False)

    row = CarTrim(
        model_id=model_id,
        generation_id=generation_id,
        autohome_spec_id=autohome_spec_id,
        name_zh=(parsed.name_zh or "")[:256],
        name_normalized=normalize_trim_name(parsed.name_zh),
        name_ru=(name_ru or parsed.name_zh or "")[:256],
        spec_fingerprint=parsed.fingerprint,
        spec_sections=doc.to_json(),
        source_spec_json=source_json,
        spec_json=source_json,
        spec_json_ru=doc.to_json(),
        source="autohome",
    )
    db.add(row)
    try:
        with db.begin_nested():
            db.flush()
    except IntegrityError:
        db.expunge(row)
        dup = db.execute(
            select(CarTrim).where(CarTrim.autohome_spec_id == autohome_spec_id)
        ).scalar_one_or_none()
        return dup.id if dup else None
    return row.id
