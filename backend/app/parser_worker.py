import os
import time
from datetime import datetime

from sqlalchemy import select

from .db import SessionLocal
from .import_plan_logic import process_import_plan
from .models import ParseJob
from .parser_logic import run_parser_job


def ensure_import_plan_tables() -> None:
    """Parser не запускает FastAPI startup — создаём таблицы плана при необходимости."""
    from sqlalchemy import text

    from .db import engine

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS import_plans (
                    id SERIAL PRIMARY KEY,
                    status VARCHAR(32) NOT NULL DEFAULT 'idle',
                    stop_requested BOOLEAN NOT NULL DEFAULT FALSE,
                    banner VARCHAR(512) NOT NULL DEFAULT '',
                    error VARCHAR(512) NOT NULL DEFAULT '',
                    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
                )
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS import_plan_items (
                    id SERIAL PRIMARY KEY,
                    plan_id INTEGER NOT NULL REFERENCES import_plans(id) ON DELETE CASCADE,
                    client_key VARCHAR(64) NOT NULL DEFAULT '',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    marketplace VARCHAR(32) NOT NULL DEFAULT 'che168',
                    brand_id INTEGER NULL,
                    brand_name VARCHAR(128) NOT NULL DEFAULT '',
                    model_id INTEGER NULL,
                    model_name VARCHAR(128) NOT NULL DEFAULT '',
                    generation_id INTEGER NULL,
                    generation_name VARCHAR(128) NOT NULL DEFAULT '',
                    url VARCHAR(2048) NOT NULL DEFAULT '',
                    status VARCHAR(32) NOT NULL DEFAULT 'pending',
                    attempts INTEGER NOT NULL DEFAULT 0,
                    message VARCHAR(512) NOT NULL DEFAULT '',
                    parse_job_id INTEGER NULL REFERENCES parse_jobs(id)
                )
                """
            )
        )
        conn.execute(
            text(
                "INSERT INTO import_plans (id, status, stop_requested, banner, error) "
                "SELECT 1, 'idle', FALSE, '', '' "
                "WHERE NOT EXISTS (SELECT 1 FROM import_plans WHERE id = 1)"
            )
        )


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
    try:
        ensure_import_plan_tables()
    except Exception:
        import logging

        logging.getLogger(__name__).exception("ensure_import_plan_tables failed")
    while True:
        enqueue_daily_job_if_needed()
        process_import_plan_queue()
        process_pending_jobs()
        time.sleep(poll_seconds)
