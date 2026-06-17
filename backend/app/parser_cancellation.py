"""Запросы остановки задач парсера (in-process + чтение из БД в parser_logic)."""

from __future__ import annotations

import threading

_lock = threading.Lock()
_cancelled_job_ids: set[int] = set()


def request_cancel(job_id: int) -> None:
    with _lock:
        _cancelled_job_ids.add(int(job_id))


def is_cancel_requested(job_id: int) -> bool:
    with _lock:
        return int(job_id) in _cancelled_job_ids


def clear_cancel(job_id: int) -> None:
    with _lock:
        _cancelled_job_ids.discard(int(job_id))
