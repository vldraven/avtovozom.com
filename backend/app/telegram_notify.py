import logging
import os

import httpx

logger = logging.getLogger(__name__)


def _admin_chat_id() -> str:
    return (os.getenv("TELEGRAM_ADMIN_CHAT_ID") or os.getenv("TELEGRAM_CHAT_ID") or "").strip()


def _bot_token() -> str:
    return (os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()


def _send_admin_message(text: str, *, disable_preview: bool = False) -> None:
    token = _bot_token()
    chat_id = _admin_chat_id()
    if not token or not chat_id:
        return
    try:
        r = httpx.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={
                "chat_id": chat_id,
                "text": text,
                "disable_web_page_preview": disable_preview,
            },
            timeout=12.0,
        )
        if r.status_code >= 400:
            logger.warning("Telegram sendMessage failed: %s %s", r.status_code, r.text[:300])
    except Exception as e:
        logger.warning("Telegram sendMessage error: %s", e)


def notify_calculation_request(
    *,
    request_id: int,
    car_id: int | None,
    user_name: str,
    user_contact: str,
    comment: str,
    car_page_url: str | None = None,
    source: str | None = None,
) -> None:
    if car_id is not None:
        header = f"Новая заявка на расчёт #{request_id}"
    else:
        header = f"Новая заявка на расчёт (авто вне каталога) #{request_id}"

    lines = [
        header,
        f"Клиент: {user_name}",
        f"Контакт: {user_contact}",
    ]
    src = (source or "").strip()
    if src:
        lines.append(f"Источник: {src}")
    if car_id is not None:
        url = (car_page_url or "").strip() or f"car_id={car_id}"
        lines.append(f"Авто (car_id={car_id}): {url}")
    c = (comment or "").strip()
    if c:
        label = "Описание авто/комментарий" if car_id is None else "Комментарий"
        lines.append(f"{label}: {c[:1200]}")
    _send_admin_message(
        "\n".join(lines),
        disable_preview=car_id is None,
    )


def notify_new_calculation_request(
    *,
    request_id: int,
    car_id: int,
    user_name: str,
    user_contact: str,
    comment: str,
    car_page_url: str,
) -> None:
    notify_calculation_request(
        request_id=request_id,
        car_id=car_id,
        user_name=user_name,
        user_contact=user_contact,
        comment=comment,
        car_page_url=car_page_url,
        source="website",
    )
