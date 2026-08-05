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


def _param_drive_value(doc) -> str | None:
    for sec in doc.param_sections or []:
        if not isinstance(sec, dict):
            continue
        for it in sec.get("items") or []:
            if not isinstance(it, dict):
                continue
            if str(it.get("name") or "") == "Привод":
                val = str(it.get("value") or "").strip()
                if val and val != "—":
                    return val
    return None


def refresh_trim_from_autohome(trim: CarTrim) -> dict[str, Any]:
    """
    Повторный fetch GetModelConfig2 → source_spec_json + русский spec_sections.
    Нужен после правок парсера (_item_value), т.к. старый source уже с «—».

    Если config-секции уже богатые на русском — обновляем только param_sections
    (где «Привод»), без повторного онлайн-перевода всей комплектации.
    """
    from .trim_display import prepare_param_sections_from_zh
    from .trim_spec_storage import TrimSpecDocument, parse_trim_spec_document

    if not trim.autohome_spec_id:
        return {"ok": False, "reason": "no_spec_id"}
    try:
        parsed = fetch_spec_config(int(trim.autohome_spec_id))
    except Exception as exc:
        log.warning(
            "autohome refresh failed trim_id=%s spec_id=%s: %s",
            trim.id,
            trim.autohome_spec_id,
            exc,
        )
        return {"ok": False, "reason": "fetch_failed", "error": str(exc)}

    if not parsed.sections:
        return {"ok": False, "reason": "empty_sections"}

    source_json = json.dumps(parsed.sections, ensure_ascii=False)
    trim.source_spec_json = source_json
    trim.spec_json = source_json

    new_params = prepare_param_sections_from_zh(parsed.sections)
    existing = parse_trim_spec_document(trim.spec_sections or trim.spec_json_ru or "")
    if existing and is_rich_trim_spec(existing) and existing.sections:
        doc = TrimSpecDocument(
            sections=existing.sections,
            param_sections=new_params or existing.param_sections,
        )
    else:
        doc = build_trim_spec_from_source_sections(parsed.sections)
    if doc.is_empty:
        return {"ok": False, "reason": "empty_doc"}

    save_trim_spec_to_row(trim, doc)
    trim.spec_json_ru = trim.spec_sections

    drive = _param_drive_value(doc)
    return {
        "ok": True,
        "trim_id": trim.id,
        "autohome_spec_id": trim.autohome_spec_id,
        "has_drive": bool(drive),
        "drive": drive,
    }


def refresh_all_trims_from_autohome(
    db: Session,
    *,
    limit: int | None = None,
    sleep_s: float = 0.35,
) -> dict[str, Any]:
    """Обновить все car_trims с autohome_spec_id. Возвращает сводку."""
    import time

    q = (
        select(CarTrim)
        .where(CarTrim.autohome_spec_id.is_not(None))
        .order_by(CarTrim.id.asc())
    )
    if limit is not None:
        q = q.limit(limit)
    trims = db.execute(q).scalars().all()

    updated = 0
    with_drive = 0
    failed = 0
    errors: list[dict[str, Any]] = []
    drives_sample: list[dict[str, Any]] = []

    for i, trim in enumerate(trims):
        result = refresh_trim_from_autohome(trim)
        if result.get("ok"):
            try:
                db.commit()
            except Exception as exc:
                db.rollback()
                failed += 1
                errors.append(
                    {
                        "trim_id": trim.id,
                        "spec_id": trim.autohome_spec_id,
                        "reason": "commit_failed",
                        "error": str(exc),
                    }
                )
            else:
                updated += 1
                if result.get("has_drive"):
                    with_drive += 1
                    if len(drives_sample) < 20:
                        drives_sample.append(
                            {
                                "trim_id": trim.id,
                                "spec_id": trim.autohome_spec_id,
                                "drive": result.get("drive"),
                            }
                        )
        else:
            db.rollback()
            failed += 1
            errors.append(
                {
                    "trim_id": trim.id,
                    "spec_id": trim.autohome_spec_id,
                    "reason": result.get("reason"),
                    "error": result.get("error"),
                }
            )
        if sleep_s > 0 and i + 1 < len(trims):
            time.sleep(sleep_s)

    return {
        "scanned": len(trims),
        "updated": updated,
        "with_drive": with_drive,
        "failed": failed,
        "errors_sample": errors[:15],
        "drives_sample": drives_sample,
    }


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
    preferred_generation_id: int | None = None,
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

    generation_id = preferred_generation_id
    if generation_id is not None:
        gen = db.get(CarGeneration, generation_id)
        if gen is None or gen.model_id != model_id:
            generation_id = None
    if generation_id is None:
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
