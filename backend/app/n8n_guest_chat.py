"""Гостевой чат сайта ↔ n8n AI-консультант (тот же, что в Telegram)."""

from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Chat, ChatMessage, Role, User
from .n8n_client import n8n_webhook_post
from .telegram_notify import notify_guest_chat_handoff

logger = logging.getLogger(__name__)

GUEST_CHAT_WEBHOOK_URL_ENV = "N8N_GUEST_CHAT_WEBHOOK_URL"
GUEST_CHAT_WEBHOOK_SECRET_ENV = "N8N_GUEST_CHAT_WEBHOOK_SECRET"
GUEST_CHAT_TIMEOUT_ENV = "N8N_GUEST_CHAT_TIMEOUT_SEC"
GUEST_CHAT_SENDER_USER_ID_ENV = "N8N_GUEST_CHAT_SENDER_USER_ID"
# Fallback: тот же секрет, что у Telegram-бота консультанта.
BOT_API_SECRET_ENV = "N8N_TELEGRAM_BOT_API_SECRET"


class N8nGuestChatReplyIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)


class N8nGuestChatReplyOut(BaseModel):
    ok: bool = True
    message_id: int
    chat_id: int


class N8nGuestChatHandoffIn(BaseModel):
    reason: str = Field(default="", max_length=1000)


class N8nGuestChatHandoffOut(BaseModel):
    ok: bool = True
    chat_id: int


def guest_chat_webhook_configured() -> bool:
    return bool((os.getenv(GUEST_CHAT_WEBHOOK_URL_ENV) or "").strip())


def _guest_chat_webhook_secret() -> str | None:
    """Секрет исходящего webhook; если пусто — берём секрет bot API."""
    direct = (os.getenv(GUEST_CHAT_WEBHOOK_SECRET_ENV) or "").strip()
    if direct:
        return direct
    return (os.getenv(BOT_API_SECRET_ENV) or "").strip() or None


def _resolve_consultant_sender_id(db: Session) -> int:
    raw = (os.getenv(GUEST_CHAT_SENDER_USER_ID_ENV) or "").strip()
    if raw:
        try:
            uid = int(raw)
        except ValueError as e:
            raise HTTPException(
                status_code=503,
                detail=f"{GUEST_CHAT_SENDER_USER_ID_ENV} должен быть числом (user id)",
            ) from e
        user = db.execute(
            select(User).where(User.id == uid, User.is_active.is_(True))
        ).scalar_one_or_none()
        if not user:
            raise HTTPException(
                status_code=503,
                detail=f"Пользователь {GUEST_CHAT_SENDER_USER_ID_ENV}={uid} не найден или неактивен",
            )
        return user.id

    admin = db.execute(
        select(User)
        .join(Role, User.role_id == Role.id)
        .where(Role.code == "admin", User.is_active.is_(True))
        .order_by(User.id.asc())
        .limit(1)
    ).scalar_one_or_none()
    if not admin:
        raise HTTPException(
            status_code=503,
            detail=(
                "Нет активного admin для ответов консультанта. "
                f"Задайте {GUEST_CHAT_SENDER_USER_ID_ENV}."
            ),
        )
    return admin.id


def _get_guest_chat(db: Session, chat_id: int) -> Chat:
    chat = db.execute(select(Chat).where(Chat.id == chat_id)).scalar_one_or_none()
    if not chat or chat.chat_type != "guest":
        raise HTTPException(status_code=404, detail="Guest chat not found")
    return chat


def build_guest_chat_history(
    db: Session,
    chat_id: int,
    *,
    limit: int = 20,
) -> list[dict[str, Any]]:
    rows = (
        db.execute(
            select(ChatMessage)
            .where(ChatMessage.chat_id == chat_id)
            .order_by(ChatMessage.id.desc())
            .limit(max(1, min(limit, 50)))
        )
        .scalars()
        .all()
    )
    history: list[dict[str, Any]] = []
    for m in reversed(rows):
        text = (m.text or "").strip()
        if not text:
            continue
        role = "guest" if m.sender_user_id is None else "consultant"
        history.append({"role": role, "text": text[:1200]})
    return history


def forward_guest_message_to_n8n(
    *,
    chat_id: int,
    guest_token: str,
    text: str,
    created: bool,
    history: list[dict[str, Any]],
    messages_url: str | None = None,
) -> None:
    """Фоновый вызов n8n. Ошибки только логируем — гость уже получил 200."""
    url = (os.getenv(GUEST_CHAT_WEBHOOK_URL_ENV) or "").strip()
    if not url:
        return
    timeout = float(os.getenv(GUEST_CHAT_TIMEOUT_ENV, "120"))
    payload = {
        "event": "guest_chat_message",
        "channel": "guest_chat",
        "chat_id": chat_id,
        "guest_token": guest_token,
        "text": text,
        "created": created,
        "history": history,
        "messages_url": messages_url or "",
    }
    ok, data, err = n8n_webhook_post(
        url=url,
        secret=_guest_chat_webhook_secret(),
        payload=payload,
        timeout_sec=timeout,
    )
    if not ok:
        logger.warning(
            "n8n guest-chat webhook failed chat_id=%s: %s",
            chat_id,
            err,
        )
        return
    if isinstance(data, dict) and data.get("ok") is False:
        logger.warning(
            "n8n guest-chat webhook returned ok=false chat_id=%s: %s",
            chat_id,
            str(data)[:400],
        )


def post_guest_chat_reply(
    db: Session,
    chat_id: int,
    payload: N8nGuestChatReplyIn,
) -> N8nGuestChatReplyOut:
    chat = _get_guest_chat(db, chat_id)
    text_clean = (payload.text or "").strip()
    if not text_clean:
        raise HTTPException(status_code=400, detail="text is required")

    sender_id = _resolve_consultant_sender_id(db)
    msg = ChatMessage(
        chat_id=chat.id,
        sender_user_id=sender_id,
        message_type="text",
        text=text_clean,
    )
    db.add(msg)
    db.flush()
    db.refresh(msg)
    chat.last_message_at = msg.created_at
    chat.dealer_last_read_message_id = msg.id
    db.commit()
    db.refresh(msg)
    return N8nGuestChatReplyOut(ok=True, message_id=msg.id, chat_id=chat.id)


def handoff_guest_chat(
    db: Session,
    chat_id: int,
    payload: N8nGuestChatHandoffIn,
    *,
    messages_url: str | None = None,
) -> N8nGuestChatHandoffOut:
    chat = _get_guest_chat(db, chat_id)
    notify_guest_chat_handoff(
        chat_id=chat.id,
        reason=payload.reason,
        messages_url=messages_url,
    )
    return N8nGuestChatHandoffOut(ok=True, chat_id=chat.id)
