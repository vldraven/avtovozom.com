import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

WEBHOOK_SECRET_HEADER = "X-N8N-Webhook-Secret"


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
