"""Отложенные email-уведомления о непрочитанных сообщениях в чате.

Письмо уходит только если клиент за DELAY_SEC так и не прочитал тред.
Пока pending — новые сообщения обновляют preview/target, но не сдвигают send_after.
После sent — повторных писем нет, пока клиент не прочитает (cooldown).
"""

from __future__ import annotations

import logging
import os
import threading
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .email_utils import send_email
from .models import Chat, ChatEmailNotification, ChatMessage, User

logger = logging.getLogger(__name__)

STATUS_PENDING = "pending"
STATUS_SENT = "sent"
STATUS_CANCELLED = "cancelled"


def notify_delay_seconds() -> int:
    return max(0, int(os.getenv("CHAT_EMAIL_NOTIFY_DELAY_SEC", "180")))


def notify_poll_seconds() -> int:
    return max(5, int(os.getenv("CHAT_EMAIL_NOTIFY_POLL_SEC", "30")))


def _public_web_origin() -> str:
    return (
        os.getenv("PUBLIC_WEB_ORIGIN")
        or os.getenv("NEXT_PUBLIC_SITE_URL")
        or "http://localhost:3000"
    ).rstrip("/")


def _messages_url(chat_id: int) -> str:
    return f"{_public_web_origin()}/messages?chat={chat_id}"


def _unread_for_client(db: Session, chat: Chat) -> int:
    lr = chat.user_last_read_message_id or 0
    if chat.user_id is None:
        return 0
    return int(
        db.execute(
            select(func.count())
            .select_from(ChatMessage)
            .where(
                ChatMessage.chat_id == chat.id,
                ChatMessage.sender_user_id.is_not(None),
                ChatMessage.sender_user_id != chat.user_id,
                ChatMessage.message_type != "system",
                ChatMessage.id > lr,
            )
        ).scalar_one()
    )


def _client_has_unread_through(db: Session, chat: Chat, message_id: int) -> bool:
    lr = chat.user_last_read_message_id or 0
    return message_id > lr


def schedule_chat_email_notification(
    db: Session,
    *,
    user_id: int,
    chat_id: int,
    message_id: int,
    preview: str,
    now: datetime | None = None,
) -> ChatEmailNotification | None:
    """Поставить/обновить pending-уведомление для клиента.

    Вызывать только когда получатель — зарегистрированный клиент чата.
    """
    now = now or datetime.utcnow()
    preview_clean = (preview or "").strip()[:500]

    chat = db.execute(select(Chat).where(Chat.id == chat_id)).scalar_one_or_none()
    if not chat or chat.user_id is None or chat.user_id != user_id:
        return None
    if chat.chat_type == "guest":
        return None

    user = db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
    if not user or not user.is_active or not user.email_verified:
        return None
    email = (user.email or "").strip()
    if not email:
        return None

    pending = (
        db.execute(
            select(ChatEmailNotification)
            .where(
                ChatEmailNotification.user_id == user_id,
                ChatEmailNotification.chat_id == chat_id,
                ChatEmailNotification.status == STATUS_PENDING,
            )
            .order_by(ChatEmailNotification.id.desc())
            .limit(1)
        )
        .scalars()
        .first()
    )
    if pending:
        pending.target_message_id = message_id
        pending.preview = preview_clean
        pending.updated_at = now
        db.flush()
        return pending

    # Cooldown после sent, пока клиент не прочитал то сообщение.
    last_sent = (
        db.execute(
            select(ChatEmailNotification)
            .where(
                ChatEmailNotification.user_id == user_id,
                ChatEmailNotification.chat_id == chat_id,
                ChatEmailNotification.status == STATUS_SENT,
            )
            .order_by(ChatEmailNotification.sent_at.desc(), ChatEmailNotification.id.desc())
            .limit(1)
        )
        .scalars()
        .first()
    )
    if last_sent and _client_has_unread_through(db, chat, last_sent.target_message_id):
        return None

    row = ChatEmailNotification(
        user_id=user_id,
        chat_id=chat_id,
        status=STATUS_PENDING,
        target_message_id=message_id,
        preview=preview_clean,
        send_after=now + timedelta(seconds=notify_delay_seconds()),
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.flush()
    return row


def process_due_chat_email_notifications(
    db: Session,
    *,
    now: datetime | None = None,
    limit: int = 50,
) -> dict[str, int]:
    """Обработать due pending: cancel если прочитано, иначе отправить письмо."""
    now = now or datetime.utcnow()
    due = (
        db.execute(
            select(ChatEmailNotification)
            .where(
                ChatEmailNotification.status == STATUS_PENDING,
                ChatEmailNotification.send_after <= now,
            )
            .order_by(ChatEmailNotification.send_after.asc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    sent = cancelled = skipped = 0
    for row in due:
        chat = db.execute(select(Chat).where(Chat.id == row.chat_id)).scalar_one_or_none()
        user = db.execute(select(User).where(User.id == row.user_id)).scalar_one_or_none()
        if not chat or not user or chat.user_id != row.user_id:
            row.status = STATUS_CANCELLED
            row.updated_at = now
            cancelled += 1
            continue

        if not _client_has_unread_through(db, chat, row.target_message_id):
            row.status = STATUS_CANCELLED
            row.updated_at = now
            cancelled += 1
            continue

        unread = _unread_for_client(db, chat)
        if unread <= 0:
            row.status = STATUS_CANCELLED
            row.updated_at = now
            cancelled += 1
            continue

        email = (user.email or "").strip()
        if not email or not user.email_verified:
            row.status = STATUS_CANCELLED
            row.updated_at = now
            cancelled += 1
            continue

        if unread == 1:
            count_line = "У вас 1 непрочитанное сообщение."
        else:
            count_line = f"У вас {unread} непрочитанных сообщений."

        subject = "Новое сообщение в чате Avtovozom"
        body = (
            f"Здравствуйте!\n\n"
            f"Вам написали в чате Avtovozom.\n"
            f"{count_line}\n\n"
            f"Открыть чат: {_messages_url(chat.id)}\n\n"
            f"— Avtovozom\n"
        )
        try:
            send_email(email, subject, body)
        except Exception:
            logger.exception(
                "chat email notify failed user_id=%s chat_id=%s",
                row.user_id,
                row.chat_id,
            )
            skipped += 1
            continue

        row.status = STATUS_SENT
        row.sent_at = now
        row.updated_at = now
        sent += 1

    if due:
        db.commit()
    return {"sent": sent, "cancelled": cancelled, "skipped": skipped, "due": len(due)}


_worker_stop = threading.Event()
_worker_thread: threading.Thread | None = None


def _worker_loop() -> None:
    from .db import SessionLocal

    while not _worker_stop.wait(timeout=notify_poll_seconds()):
        db = SessionLocal()
        try:
            stats = process_due_chat_email_notifications(db)
            if stats.get("due"):
                logger.info("chat email notify tick %s", stats)
        except Exception:
            logger.exception("chat email notify worker tick failed")
            try:
                db.rollback()
            except Exception:
                pass
        finally:
            db.close()


def start_chat_email_notify_worker() -> None:
    """Фоновый тик внутри FastAPI process (daemon)."""
    global _worker_thread
    if os.getenv("CHAT_EMAIL_NOTIFY_WORKER", "1").strip() in ("0", "false", "no"):
        logger.info("chat email notify worker disabled")
        return
    if _worker_thread and _worker_thread.is_alive():
        return
    _worker_stop.clear()
    _worker_thread = threading.Thread(
        target=_worker_loop,
        name="chat-email-notify",
        daemon=True,
    )
    _worker_thread.start()
    logger.info(
        "chat email notify worker started delay=%ss poll=%ss",
        notify_delay_seconds(),
        notify_poll_seconds(),
    )


def stop_chat_email_notify_worker() -> None:
    _worker_stop.set()
