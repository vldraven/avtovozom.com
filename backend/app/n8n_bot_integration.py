"""Создание заявок и ответов консультанта из n8n (Telegram + web guest chat)."""

from __future__ import annotations

import os
from typing import Any, Literal

from fastapi import Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import CalculationRequest, Car, Chat, ChatMessage
from .n8n_client import WEBHOOK_SECRET_HEADER
from .telegram_notify import notify_calculation_request

N8N_BOT_API_SECRET_ENV = "N8N_TELEGRAM_BOT_API_SECRET"

ALLOWED_LEAD_SOURCES = frozenset({"telegram_bot", "guest_web"})


class N8nBotCreateRequestIn(BaseModel):
    user_name: str = Field(..., min_length=1, max_length=128)
    user_contact: str = Field(..., min_length=3, max_length=128)
    car_id: int | None = None
    comment: str = Field(..., min_length=3, max_length=4000)
    telegram_chat_id: str | None = Field(default=None, max_length=64)
    telegram_username: str | None = Field(default=None, max_length=64)
    guest_token: str | None = Field(default=None, max_length=64)
    source: Literal["telegram_bot", "guest_web"] | None = None


class N8nBotCreateRequestOut(BaseModel):
    ok: bool = True
    request_id: int


class N8nGuestReplyIn(BaseModel):
    guest_token: str = Field(..., min_length=8, max_length=128)
    text: str = Field(..., min_length=1, max_length=4000)
    chat_id: int | None = None


class N8nGuestReplyOut(BaseModel):
    ok: bool = True
    message_id: int
    chat_id: int


def verify_n8n_bot_api_secret(
    x_n8n_webhook_secret: str | None = Header(default=None, alias=WEBHOOK_SECRET_HEADER),
) -> None:
    expected = (os.getenv(N8N_BOT_API_SECRET_ENV) or "").strip()
    if not expected:
        raise HTTPException(
            status_code=503,
            detail="N8N_TELEGRAM_BOT_API_SECRET не настроен на сервере",
        )
    got = (x_n8n_webhook_secret or "").strip()
    if got != expected:
        raise HTTPException(status_code=403, detail="Forbidden")


def _build_telegram_contact(
    *,
    user_contact: str,
    telegram_chat_id: str | None,
    telegram_username: str | None,
    guest_token: str | None = None,
) -> str:
    base = user_contact.strip()
    parts: list[str] = [base]
    if telegram_username:
        un = telegram_username.strip().lstrip("@")
        if un and f"@{un}" not in base and un not in base:
            parts.append(f"tg:@{un}")
    if telegram_chat_id:
        cid = telegram_chat_id.strip()
        if cid and cid not in base:
            parts.append(f"tg_id:{cid}")
    if guest_token:
        gt = guest_token.strip()
        if gt:
            # short marker for staff; full token is not needed in contact line
            parts.append(f"guest:{gt[:12]}")
    return " · ".join(parts)[:128]


def create_bot_calculation_request(
    db: Session,
    payload: N8nBotCreateRequestIn,
    *,
    public_car_page_url: Any,
) -> N8nBotCreateRequestOut:
    comment = payload.comment.strip()
    if not comment:
        raise HTTPException(status_code=400, detail="comment is required")

    car_id = payload.car_id
    if car_id is not None:
        car_exists = db.execute(
            select(Car.id).where(Car.id == car_id, Car.is_active.is_(True))
        ).scalar_one_or_none()
        if car_exists is None:
            raise HTTPException(status_code=404, detail="Car not found")

    source = (payload.source or "telegram_bot").strip()
    if source not in ALLOWED_LEAD_SOURCES:
        raise HTTPException(status_code=400, detail="Invalid source")

    user_name = payload.user_name.strip()
    user_contact = _build_telegram_contact(
        user_contact=payload.user_contact,
        telegram_chat_id=payload.telegram_chat_id,
        telegram_username=payload.telegram_username,
        guest_token=payload.guest_token if source == "guest_web" else None,
    )

    req = CalculationRequest(
        user_name=user_name,
        user_contact=user_contact,
        user_id=None,
        car_id=car_id,
        comment=comment,
        source=source,
        status="open",
    )
    db.add(req)
    db.commit()
    db.refresh(req)

    car_page_url = public_car_page_url(db, car_id) if car_id is not None else None
    notify_calculation_request(
        request_id=req.id,
        car_id=car_id,
        user_name=user_name,
        user_contact=user_contact,
        comment=comment,
        car_page_url=car_page_url,
        source=source,
    )
    return N8nBotCreateRequestOut(ok=True, request_id=req.id)


def post_guest_bot_reply(
    db: Session,
    payload: N8nGuestReplyIn,
) -> N8nGuestReplyOut:
    token = (payload.guest_token or "").strip()
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    chat = db.execute(
        select(Chat).where(Chat.chat_type == "guest", Chat.guest_token == token)
    ).scalar_one_or_none()
    if chat is None:
        raise HTTPException(status_code=404, detail="Guest chat not found")
    if payload.chat_id is not None and payload.chat_id != chat.id:
        raise HTTPException(status_code=400, detail="chat_id mismatch")

    msg = ChatMessage(
        chat_id=chat.id,
        sender_user_id=None,
        message_type="assistant",
        text=text,
    )
    db.add(msg)
    db.flush()
    db.refresh(msg)
    chat.last_message_at = msg.created_at
    db.commit()
    db.refresh(msg)
    return N8nGuestReplyOut(ok=True, message_id=msg.id, chat_id=chat.id)
