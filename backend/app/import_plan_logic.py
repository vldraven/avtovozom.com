"""Серверный оркестратор плана импорта (очередь ссылок → ParseJob import_one)."""

from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from .che168_parser import marketplace_from_detail_url, normalize_import_detail_url
from .models import CarGeneration, CarModel, ImportPlan, ImportPlanItem, ParseJob
from .parser_cancellation import request_cancel
from .parser_logic import run_parser_job

logger = logging.getLogger(__name__)

IMPORT_PLAN_MAX_RETRIES = 3
SHARED_PLAN_ID = 1


def ensure_import_plan(db: Session) -> ImportPlan:
    plan = db.execute(
        select(ImportPlan)
        .options(joinedload(ImportPlan.items))
        .where(ImportPlan.id == SHARED_PLAN_ID)
    ).unique().scalar_one_or_none()
    if plan:
        return plan
    plan = ImportPlan(id=SHARED_PLAN_ID, status="idle")
    db.add(plan)
    db.commit()
    return db.execute(
        select(ImportPlan)
        .options(joinedload(ImportPlan.items))
        .where(ImportPlan.id == SHARED_PLAN_ID)
    ).unique().scalar_one()


def _touch(plan: ImportPlan) -> None:
    plan.updated_at = datetime.utcnow()


def _queueable_items(items: list[ImportPlanItem]) -> list[ImportPlanItem]:
    out: list[ImportPlanItem] = []
    for item in sorted(items, key=lambda x: (x.sort_order, x.id)):
        if not item.model_id or not (item.url or "").strip():
            continue
        if item.status == "success":
            continue
        if item.status == "failed" and item.attempts >= IMPORT_PLAN_MAX_RETRIES:
            continue
        if item.status == "cancelled" and item.attempts >= IMPORT_PLAN_MAX_RETRIES:
            continue
        out.append(item)
    return out


def prepare_items_for_fresh_start(items: list[ImportPlanItem]) -> None:
    for item in items:
        if item.status == "success":
            continue
        if item.status in ("failed", "cancelled", "running", "queued"):
            prev = (item.message or "").strip()
            item.status = "pending"
            item.attempts = 0
            item.parse_job_id = None
            if prev:
                cleaned = prev
                while cleaned.lower().startswith("повтор:"):
                    cleaned = cleaned[7:].strip()
                item.message = f"Повтор: {cleaned}"[:512]
            else:
                item.message = ""


def start_import_plan(db: Session) -> ImportPlan:
    plan = ensure_import_plan(db)
    if plan.status in ("running", "stopping"):
        return plan

    prepare_items_for_fresh_start(list(plan.items))
    queue = _queueable_items(list(plan.items))
    if not queue:
        has_failed = any(
            i.status == "failed" and i.attempts >= IMPORT_PLAN_MAX_RETRIES for i in plan.items
        )
        plan.status = "idle"
        plan.stop_requested = False
        plan.error = (
            "Нет строк для обхода. Добавьте модель и ссылку или нажмите «Запустить обход» "
            "ещё раз, чтобы повторить ошибки."
            if has_failed or plan.items
            else "Добавьте строки с моделью и ссылкой."
        )
        plan.banner = ""
        _touch(plan)
        db.commit()
        return ensure_import_plan(db)

    plan.status = "running"
    plan.stop_requested = False
    plan.error = ""
    plan.banner = (
        f"Старт: {len(queue)} объявлений в очереди "
        f"(до {IMPORT_PLAN_MAX_RETRIES} попыток на ссылку)."
    )[:512]
    _touch(plan)
    db.commit()
    return ensure_import_plan(db)


def request_stop_import_plan(db: Session) -> ImportPlan:
    plan = ensure_import_plan(db)
    if plan.status == "idle":
        return plan
    plan.stop_requested = True
    plan.status = "stopping"
    plan.banner = "Остановка…"
    plan.error = ""
    _touch(plan)
    active = next(
        (i for i in plan.items if i.status in ("running", "queued") and i.parse_job_id),
        None,
    )
    if active and active.parse_job_id:
        job = db.execute(
            select(ParseJob).where(ParseJob.id == active.parse_job_id)
        ).scalar_one_or_none()
        if job and job.status in ("queued", "running"):
            job.cancel_requested = True
            if job.status == "queued":
                job.status = "cancelled"
                job.finished_at = datetime.utcnow()
                job.message = "Остановлено пользователем (задача ещё не стартовала)."
            request_cancel(active.parse_job_id)
    db.commit()
    return ensure_import_plan(db)


def _finalize_stop(db: Session, plan: ImportPlan) -> None:
    for item in plan.items:
        if item.status in ("running", "queued"):
            item.status = "cancelled"
            item.message = (item.message or "Остановлено")[:512]
    plan.status = "idle"
    plan.stop_requested = False
    plan.banner = "Обход остановлен."
    plan.error = ""
    _touch(plan)
    db.commit()


def _finish_banner(plan: ImportPlan, items: list[ImportPlanItem], stopped: bool) -> str:
    if stopped:
        return "Обход остановлен."
    ok = sum(1 for i in items if i.status == "success")
    failed = sum(
        1 for i in items if i.status == "failed" and i.attempts >= IMPORT_PLAN_MAX_RETRIES
    )
    banner = "Обход завершён."
    if ok or failed:
        parts = []
        if ok:
            parts.append(f"успешно: {ok}")
        if failed:
            parts.append(f"с ошибкой: {failed}")
        banner = f"Обход завершён ({', '.join(parts)})."
        if failed:
            banner += " Неудачные можно повторить кнопкой «Запустить обход»."
    return banner[:512]


def _active_item(items: list[ImportPlanItem]) -> ImportPlanItem | None:
    for item in sorted(items, key=lambda x: (x.sort_order, x.id)):
        if item.status in ("running", "queued"):
            return item
    return None


def _apply_job_result(item: ImportPlanItem, job: ParseJob) -> str:
    """Обновляет строку по завершённому job. Возвращает: success|retry|failed|cancelled."""
    if job.status == "success":
        item.status = "success"
        item.message = (job.message or "Готово")[:512]
        return "success"
    if job.status == "cancelled":
        item.status = "cancelled"
        item.message = (job.message or "Остановлено")[:512]
        return "cancelled"
    msg = (job.message or "Ошибка импорта")[:500]
    if item.attempts >= IMPORT_PLAN_MAX_RETRIES:
        item.status = "failed"
        item.message = msg[:512]
        return "failed"
    item.status = "pending"
    item.message = f"{msg} · повтор {item.attempts + 1}/{IMPORT_PLAN_MAX_RETRIES}…"[:512]
    return "retry"


def _validate_and_normalize_item(db: Session, item: ImportPlanItem) -> str | None:
    """Возвращает текст ошибки или None при успехе (url нормализован)."""
    raw = (item.url or "").strip()
    if not item.model_id or not raw:
        return "Не указаны модель или ссылка на объявление."
    normalized = normalize_import_detail_url(raw)
    if not normalized:
        return (
            "Нужна прямая ссылка: che168 — …/dealer/…/….html, i.che168.com/car/… "
            "или m.che168.com/cardetail?infoid=…; "
            "global.che168 — …/detail/…; dongchedi — …/usedcar/…"
        )
    detected = marketplace_from_detail_url(normalized)
    mp = (item.marketplace or "che168").strip() or "che168"
    if mp != detected:
        return "Ссылка не соответствует выбранной площадке."
    model = db.execute(select(CarModel).where(CarModel.id == item.model_id)).scalar_one_or_none()
    if not model:
        return "Модель не найдена."
    if item.generation_id is not None:
        gen = db.execute(
            select(CarGeneration).where(CarGeneration.id == item.generation_id)
        ).scalar_one_or_none()
        if not gen or gen.model_id != item.model_id:
            return "Поколение не принадлежит выбранной модели."
    item.url = normalized[:2048]
    item.marketplace = detected
    return None


def _start_attempt(db: Session, plan: ImportPlan, item: ImportPlanItem) -> None:
    item.attempts = int(item.attempts or 0) + 1
    err = _validate_and_normalize_item(db, item)
    if err:
        if item.attempts >= IMPORT_PLAN_MAX_RETRIES:
            item.status = "failed"
            item.message = err[:512]
        else:
            item.status = "pending"
            item.message = f"{err} · повтор {item.attempts + 1}/{IMPORT_PLAN_MAX_RETRIES}…"[:512]
        item.parse_job_id = None
        _touch(plan)
        db.commit()
        return

    item.status = "running"
    item.message = f"Попытка {item.attempts}/{IMPORT_PLAN_MAX_RETRIES}…"[:512]
    job = ParseJob(
        type="import_one",
        status="queued",
        import_model_id=item.model_id,
        import_detail_url=item.url[:2048],
        import_generation_id=item.generation_id,
    )
    db.add(job)
    db.flush()
    item.parse_job_id = job.id
    plan.banner = f"Импорт строки: попытка {item.attempts}/{IMPORT_PLAN_MAX_RETRIES}…"[:512]
    _touch(plan)
    db.commit()
    db.refresh(job)

    try:
        run_parser_job(db, job)
    except Exception as e:
        db.refresh(job)
        if job.status == "running" and job.finished_at is None:
            job.status = "failed"
            job.message = str(e)[:500]
            job.finished_at = datetime.utcnow()
            db.commit()

    db.refresh(job)
    db.refresh(item)
    outcome = _apply_job_result(item, job)
    _touch(plan)
    db.commit()

    if plan.stop_requested or outcome == "cancelled":
        _finalize_stop(db, ensure_import_plan(db))


def process_import_plan(db: Session) -> None:
    """Продвигает серверный план: пока running — обрабатывает строки по одной."""
    while True:
        plan = ensure_import_plan(db)

        if plan.status == "stopping" or (plan.status == "running" and plan.stop_requested):
            active = _active_item(list(plan.items))
            if active and active.parse_job_id:
                job = db.execute(
                    select(ParseJob).where(ParseJob.id == active.parse_job_id)
                ).scalar_one_or_none()
                if job and job.status in ("queued", "running"):
                    # Ждём завершения/отмены текущего job
                    return
                if job and job.status not in ("queued", "running"):
                    _apply_job_result(active, job)
                    db.commit()
            _finalize_stop(db, ensure_import_plan(db))
            return

        if plan.status != "running":
            return

        items = list(plan.items)
        active = _active_item(items)
        if active:
            if active.parse_job_id:
                job = db.execute(
                    select(ParseJob).where(ParseJob.id == active.parse_job_id)
                ).scalar_one_or_none()
                if job and job.status in ("queued", "running"):
                    return
                if job:
                    outcome = _apply_job_result(active, job)
                    _touch(plan)
                    db.commit()
                    if plan.stop_requested or outcome == "cancelled":
                        _finalize_stop(db, ensure_import_plan(db))
                        return
                    continue
            else:
                active.status = "pending"
                db.commit()
                continue

        plan = ensure_import_plan(db)
        if plan.status != "running":
            return
        if plan.stop_requested:
            _finalize_stop(db, plan)
            return

        queue = _queueable_items(list(plan.items))
        if not queue:
            plan.status = "idle"
            plan.stop_requested = False
            plan.banner = _finish_banner(plan, list(plan.items), stopped=False)
            plan.error = ""
            _touch(plan)
            db.commit()
            return

        plan.banner = (
            f"В очереди: {len(queue)} (до {IMPORT_PLAN_MAX_RETRIES} попыток на ссылку)."
        )[:512]
        _touch(plan)
        db.commit()

        _start_attempt(db, plan, queue[0])
        # _start_attempt мог завершить план (stop) — цикл проверит status
