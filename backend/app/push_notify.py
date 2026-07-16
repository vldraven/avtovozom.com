"""Mobile push notifications via Expo Push API."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import UserPushDevice

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


def _expo_headers() -> dict[str, str]:
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    token = (os.getenv("EXPO_ACCESS_TOKEN") or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def get_user_push_tokens(db: Session, user_id: int) -> list[str]:
    rows = db.execute(
        select(UserPushDevice.push_token).where(UserPushDevice.user_id == user_id)
    ).scalars().all()
    return [t for t in rows if t]


def send_push_to_user(
    db: Session,
    *,
    user_id: int,
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
) -> None:
    tokens = get_user_push_tokens(db, user_id)
    if not tokens:
        return
    messages = [
        {
            "to": token,
            "sound": "default",
            "title": title,
            "body": body,
            "data": data or {},
        }
        for token in tokens
    ]
    try:
        with httpx.Client(timeout=10.0) as client:
            client.post(EXPO_PUSH_URL, json=messages, headers=_expo_headers())
    except Exception:
        logger.exception("push send failed user_id=%s", user_id)


def notify_chat_message(
    db: Session,
    *,
    recipient_user_id: int,
    chat_id: int,
    preview: str,
) -> None:
    send_push_to_user(
        db,
        user_id=recipient_user_id,
        title="Новое сообщение",
        body=preview[:180] or "Вам написали в чате",
        data={"chat_id": chat_id},
    )


def notify_new_offer(
    db: Session,
    *,
    recipient_user_id: int,
    request_id: int,
    dealer_label: str,
) -> None:
    send_push_to_user(
        db,
        user_id=recipient_user_id,
        title="Новый расчёт от дилера",
        body=f"{dealer_label} отправил предложение по вашей заявке",
        data={"request_id": request_id},
    )


def chat_message_recipient_user_id(chat, sender_user_id: int) -> int | None:
    """Определяет получателя push для чата."""
    if chat.chat_type == "platform":
        if sender_user_id == chat.user_id:
            return None
        return chat.user_id
    if chat.dealer_user_id is None:
        return None
    if sender_user_id == chat.user_id:
        return chat.dealer_user_id
    if sender_user_id == chat.dealer_user_id:
        return chat.user_id
    return None
