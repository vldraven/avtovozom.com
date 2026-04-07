"""Ограничение времени синхронных вызовов парсера (Playwright/HTTP), чтобы job не зависал в RUNNING."""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from typing import Callable, TypeVar

T = TypeVar("T")


def call_with_timeout(fn: Callable[[], T], timeout_sec: float | None = None) -> T:
    """
    Выполняет fn в отдельном потоке с таймаутом.
    У каждого вызова свой короткоживущий пул (max_workers=1), чтобы не блокировать основной поток uvicorn.
    """
    if timeout_sec is None:
        timeout_sec = float(os.getenv("CHE168_PARSE_DETAIL_TIMEOUT_SEC", "120"))
    if timeout_sec <= 0:
        return fn()

    def _run() -> T:
        return fn()

    with ThreadPoolExecutor(max_workers=1) as ex:
        fut = ex.submit(_run)
        try:
            return fut.result(timeout=timeout_sec)
        except FutureTimeoutError as e:
            raise RuntimeError(
                f"Таймаут разбора карточки ({timeout_sec:.0f} с). "
                "Проверьте доступность che168 и сеть; при блокировках укажите CHE168_FORCE_DETAIL_URLS "
                "или CHE168_SKIP_PLAYWRIGHT=1 (только HTTP)."
            ) from e
