import os
import time
from datetime import datetime

from sqlalchemy import select

from .db import SessionLocal
from .models import ParseJob
from .parser_logic import run_parser_job


def process_pending_jobs() -> None:
    db = SessionLocal()
    try:
        pending = db.execute(
            select(ParseJob).where(ParseJob.status == "queued").order_by(ParseJob.id.asc())
        ).scalars().all()
        for job in pending:
            run_parser_job(db, job)
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
        process_pending_jobs()
        time.sleep(poll_seconds)
