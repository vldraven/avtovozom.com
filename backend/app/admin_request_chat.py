"""Резолв клиента и platform-чата для админских заявок на расчёт."""

from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import CalculationRequest, Chat, ChatMessage, User

_EMAIL_RE = re.compile(r"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}", re.IGNORECASE)


def extract_emails_from_contact(contact: str | None) -> list[str]:
    """Email из user_contact (freeform: «+7…; email: a@b.ru» или просто адрес)."""
    raw = (contact or "").strip()
    if not raw:
        return []
    found = [m.group(0).lower() for m in _EMAIL_RE.finditer(raw)]
    # unique, preserve order
    out: list[str] = []
    seen: set[str] = set()
    for e in found:
        if e not in seen:
            seen.add(e)
            out.append(e)
    return out


def resolve_request_client_user(db: Session, request: CalculationRequest) -> User | None:
    """Клиент заявки: по user_id или по email из контакта (если позже зарегистрировался)."""
    if request.user_id is not None:
        user = db.execute(select(User).where(User.id == request.user_id)).scalar_one_or_none()
        if user is not None:
            return user
    for email in extract_emails_from_contact(request.user_contact):
        user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if user is not None:
            return user
    return None


def find_platform_chat_id(db: Session, user_id: int) -> int | None:
    chat = db.execute(
        select(Chat).where(Chat.chat_type == "platform", Chat.user_id == user_id)
    ).scalar_one_or_none()
    return chat.id if chat else None


def ensure_platform_chat(db: Session, user_id: int) -> Chat:
    existing = db.execute(
        select(Chat).where(Chat.chat_type == "platform", Chat.user_id == user_id)
    ).scalar_one_or_none()
    if existing:
        return existing
    chat = Chat(
        chat_type="platform",
        user_id=user_id,
        request_id=None,
        dealer_user_id=None,
        status="open",
    )
    db.add(chat)
    db.flush()
    return chat


def platform_chat_mentions_request(db: Session, chat_id: int, request_id: int) -> bool:
    needle = f"№{request_id}"
    rows = (
        db.execute(
            select(ChatMessage.text).where(
                ChatMessage.chat_id == chat_id,
                ChatMessage.message_type == "system",
            )
        )
        .scalars()
        .all()
    )
    return any(needle in (t or "") for t in rows)


def link_request_to_client_user(db: Session, request: CalculationRequest, user: User) -> bool:
    """Привязать freeform-заявку к зарегистрированному клиенту. True если изменили."""
    if request.user_id == user.id:
        return False
    if request.user_id is not None and request.user_id != user.id:
        return False
    request.user_id = user.id
    return True
