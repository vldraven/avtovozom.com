"""Создание заявок на расчёт из n8n Telegram-бота."""

from __future__ import annotations

import os
from typing import Any

from fastapi import Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import CalculationRequest, Car
from .n8n_client import WEBHOOK_SECRET_HEADER
from .telegram_notify import notify_calculation_request

N8N_BOT_API_SECRET_ENV = "N8N_TELEGRAM_BOT_API_SECRET"


class N8nBotCreateRequestIn(BaseModel):
    user_name: str = Field(..., min_length=1, max_length=128)
    user_contact: str = Field(..., min_length=3, max_length=128)
    car_id: int | None = None
    comment: str = Field(..., min_length=3, max_length=4000)
    telegram_chat_id: str | None = Field(default=None, max_length=64)
    telegram_username: str | None = Field(default=None, max_length=64)


class N8nBotCreateRequestOut(BaseModel):
    ok: bool = True
    request_id: int


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
        if not car_exists:
            raise HTTPException(status_code=404, detail="Car not found")

    user_name = payload.user_name.strip()
    user_contact = _build_telegram_contact(
        user_contact=payload.user_contact,
        telegram_chat_id=payload.telegram_chat_id,
        telegram_username=payload.telegram_username,
    )

    req = CalculationRequest(
        user_name=user_name,
        user_contact=user_contact,
        user_id=None,
        car_id=car_id,
        comment=comment,
        source="telegram_bot",
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
        source="telegram_bot",
    )
    return N8nBotCreateRequestOut(ok=True, request_id=req.id)
