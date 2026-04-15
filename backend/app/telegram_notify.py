import logging
import os

import httpx

logger = logging.getLogger(__name__)


def notify_new_calculation_request(
    *,
    request_id: int,
    car_id: int,
    user_name: str,
    user_contact: str,
    comment: str,
    car_page_url: str,
) -> None:
    token = (os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
    chat_id = (os.getenv("TELEGRAM_ADMIN_CHAT_ID") or os.getenv("TELEGRAM_CHAT_ID") or "").strip()
    if not token or not chat_id:
        return
    lines = [
        f"Новая заявка на расчёт #{request_id}",
        f"Клиент: {user_name}",
        f"Контакт: {user_contact}",
        f"Авто (car_id={car_id}): {car_page_url}",
    ]
    c = (comment or "").strip()
    if c:
        lines.append(f"Комментарий: {c[:900]}")
    text = "\n".join(lines)
    try:
        r = httpx.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text, "disable_web_page_preview": False},
            timeout=12.0,
        )
        if r.status_code >= 400:
            logger.warning("Telegram sendMessage failed: %s %s", r.status_code, r.text[:300])
    except Exception as e:
        logger.warning("Telegram sendMessage error: %s", e)
