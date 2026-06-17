"""Ограничение времени синхронных вызовов парсера (Playwright/HTTP), чтобы job не зависал в RUNNING."""

from __future__ import annotations

import os
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from typing import Callable, TypeVar

T = TypeVar("T")


class ParserJobCancelled(Exception):
    """Запрошена остановка задачи парсера."""


def call_with_timeout(fn: Callable[[], T], timeout_sec: float | None = None) -> T:
    """
    Выполняет fn в отдельном потоке с таймаутом.
    У каждого вызова свой короткоживущий пул (max_workers=1), чтобы не блокировать основной поток uvicorn.
    """
    return call_with_cancel_poll(fn, should_cancel=lambda: False, timeout_sec=timeout_sec)


def call_with_cancel_poll(
    fn: Callable[[], T],
    *,
    should_cancel: Callable[[], bool],
    timeout_sec: float | None = None,
) -> T:
    """
    Выполняет fn в потоке и периодически проверяет should_cancel (чтение флага из БД).
    Позволяет остановить задачу во время долгого Playwright/HTTP без ожидания полного таймаута.
    """
    if timeout_sec is None:
        timeout_sec = float(os.getenv("CHE168_PARSE_DETAIL_TIMEOUT_SEC", "120"))
    poll_sec = float(os.getenv("PARSER_CANCEL_POLL_SEC", "1.5"))
    if timeout_sec <= 0:
        return fn()

    ex = ThreadPoolExecutor(max_workers=1)
    try:
        fut = ex.submit(fn)
        deadline = time.monotonic() + timeout_sec
        while True:
            if should_cancel():
                raise ParserJobCancelled("Остановлено пользователем.")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RuntimeError(
                    f"Таймаут операции ({timeout_sec:.0f} с). "
                    "Проверьте доступность che168 и сеть; при блокировках укажите CHE168_FORCE_DETAIL_URLS "
                    "или CHE168_SKIP_PLAYWRIGHT=1 (только HTTP)."
                )
            try:
                return fut.result(timeout=min(poll_sec, remaining))
            except FutureTimeoutError:
                continue
    finally:
        ex.shutdown(wait=False)
