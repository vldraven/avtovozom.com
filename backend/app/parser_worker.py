import os
import time
from datetime import datetime

from sqlalchemy import select

from .db import SessionLocal
from .import_plan_logic import process_import_plan
from .models import ParseJob
from .parser_logic import run_parser_job


def process_pending_jobs() -> None:
    db = SessionLocal()
    try:
        pending = db.execute(
            select(ParseJob).where(ParseJob.status == "queued").order_by(ParseJob.id.asc())
        ).scalars().all()
        for job in pending:
            db.refresh(job)
            if job.status != "queued":
                continue
            if job.cancel_requested:
                job.status = "cancelled"
                job.finished_at = datetime.utcnow()
                job.message = "Остановлено до начала выполнения."
                db.commit()
                continue
            run_parser_job(db, job)
    finally:
        db.close()


def process_import_plan_queue() -> None:
    db = SessionLocal()
    try:
        process_import_plan(db)
    except Exception:
        # Не роняем воркер из‑за сбоя плана — следующий тик повторит.
        import logging

        logging.getLogger(__name__).exception("import plan tick failed")
    finally:
        db.close()


def enqueue_daily_job_if_needed() -> None:
    db = SessionLocal()
    try:
        latest = db.execute(select(ParseJob).order_by(ParseJob.id.desc()).limit(1)).scalar_one_or_none()
        if not latest or (latest.started_at and (datetime.utcnow() - latest.started_at).total_seconds() > 20 * 3600):
            db.add(ParseJob(type="daily", status="queued"))
            db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    # Интервал между циклами (опрос очереди и daily-cron) — секунды, не часы.
    poll_seconds = int(os.getenv("PARSER_POLL_SECONDS", "10"))
    while True:
        enqueue_daily_job_if_needed()
        process_import_plan_queue()
        process_pending_jobs()
        time.sleep(poll_seconds)
