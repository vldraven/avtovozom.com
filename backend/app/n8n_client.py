import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

WEBHOOK_SECRET_HEADER = "X-N8N-Webhook-Secret"

N8N_GUEST_CHAT_WEBHOOK_URL_ENV = "N8N_GUEST_CHAT_WEBHOOK_URL"
N8N_GUEST_CHAT_WEBHOOK_SECRET_ENV = "N8N_GUEST_CHAT_WEBHOOK_SECRET"
N8N_GUEST_CHAT_TIMEOUT_SEC_ENV = "N8N_GUEST_CHAT_TIMEOUT_SEC"


def n8n_webhook_post(
    *,
    url: str | None,
    secret: str | None,
    payload: dict[str, Any],
    timeout_sec: float,
) -> tuple[bool, Any | None, str]:
    """
    Вызывает n8n production webhook и возвращает распарсенный JSON (обычно dict).
    При ошибках сети/HTTP второй элемент — частичное тело ответа или None.
    """
    u = (url or "").strip()
    if not u:
        return False, None, "N8n webhook URL не задан"

    headers = {"Content-Type": "application/json"}
    sec = (secret or "").strip()
    if sec:
        headers[WEBHOOK_SECRET_HEADER] = sec

    try:
        r = httpx.post(u, json=payload, headers=headers, timeout=timeout_sec)
    except httpx.TimeoutException:
        return False, None, "Таймаут вызова n8n webhook"
    except Exception as e:
        logger.warning("n8n webhook error: %s", e)
        return False, None, str(e)[:400]

    if r.status_code >= 400:
        return False, None, (r.text or f"HTTP {r.status_code}")[:500]

    try:
        return True, r.json(), ""
    except Exception:
        return True, {"raw_text": (r.text or "")[:2000]}, ""


def guest_chat_ai_webhook_configured() -> bool:
    return bool((os.getenv(N8N_GUEST_CHAT_WEBHOOK_URL_ENV) or "").strip())


def trigger_guest_chat_ai(payload: dict[str, Any]) -> tuple[bool, str]:
    """Fire-and-forget-friendly call to the guest consultant n8n workflow."""
    url = (os.getenv(N8N_GUEST_CHAT_WEBHOOK_URL_ENV) or "").strip()
    secret = (os.getenv(N8N_GUEST_CHAT_WEBHOOK_SECRET_ENV) or "").strip()
    try:
        timeout_sec = float(os.getenv(N8N_GUEST_CHAT_TIMEOUT_SEC_ENV) or "120")
    except ValueError:
        timeout_sec = 120.0
    timeout_sec = max(15.0, min(timeout_sec, 300.0))
    ok, _, err = n8n_webhook_post(
        url=url,
        secret=secret or None,
        payload=payload,
        timeout_sec=timeout_sec,
    )
    if not ok:
        logger.warning("guest chat AI webhook failed: %s", err)
        return False, err
    return True, ""
