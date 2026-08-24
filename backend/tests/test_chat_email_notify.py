"""Delayed chat email notifications for unread client messages."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.chat_email_notify import (
    STATUS_CANCELLED,
    STATUS_PENDING,
    STATUS_SENT,
    process_due_chat_email_notifications,
    schedule_chat_email_notification,
)
from app.models import Chat, ChatEmailNotification, ChatMessage, Role, User
from app.security import hash_password


class ChatEmailNotifyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Role.__table__.create(bind=self.engine)
        User.__table__.create(bind=self.engine)
        Chat.__table__.create(bind=self.engine)
        ChatMessage.__table__.create(bind=self.engine)
        ChatEmailNotification.__table__.create(bind=self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

        user_role = Role(code="user", name="User")
        dealer_role = Role(code="dealer", name="Dealer")
        self.db.add_all([user_role, dealer_role])
        self.db.flush()

        self.client_user = User(
            email="client@example.com",
            password_hash=hash_password("pass12345"),
            role_id=user_role.id,
            full_name="Client",
            is_active=True,
            email_verified=True,
        )
        self.dealer = User(
            email="dealer@example.com",
            password_hash=hash_password("pass12345"),
            role_id=dealer_role.id,
            full_name="Dealer",
            company_name="Dealer Co",
            is_active=True,
            email_verified=True,
        )
        self.db.add_all([self.client_user, self.dealer])
        self.db.flush()

        self.chat = Chat(
            chat_type="platform",
            user_id=self.client_user.id,
            dealer_user_id=None,
            status="open",
        )
        self.db.add(self.chat)
        self.db.commit()
        self.db.refresh(self.client_user)
        self.db.refresh(self.dealer)
        self.db.refresh(self.chat)

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def _dealer_message(self, text: str = "Расчёт готов") -> ChatMessage:
        msg = ChatMessage(
            chat_id=self.chat.id,
            sender_user_id=self.dealer.id,
            message_type="text",
            text=text,
        )
        self.db.add(msg)
        self.db.flush()
        self.chat.last_message_at = msg.created_at
        self.db.commit()
        self.db.refresh(msg)
        return msg

    def test_schedule_creates_pending(self) -> None:
        msg = self._dealer_message()
        now = datetime(2026, 1, 1, 12, 0, 0)
        with patch("app.chat_email_notify.notify_delay_seconds", return_value=180):
            row = schedule_chat_email_notification(
                self.db,
                user_id=self.client_user.id,
                chat_id=self.chat.id,
                message_id=msg.id,
                preview=msg.text or "",
                now=now,
            )
            self.db.commit()
        self.assertIsNotNone(row)
        self.assertEqual(row.status, STATUS_PENDING)
        self.assertEqual(row.target_message_id, msg.id)
        self.assertEqual(row.send_after, now + timedelta(seconds=180))

    def test_second_message_updates_pending_without_shifting_send_after(self) -> None:
        msg1 = self._dealer_message("Первое")
        now = datetime(2026, 1, 1, 12, 0, 0)
        with patch("app.chat_email_notify.notify_delay_seconds", return_value=180):
            row1 = schedule_chat_email_notification(
                self.db,
                user_id=self.client_user.id,
                chat_id=self.chat.id,
                message_id=msg1.id,
                preview="Первое",
                now=now,
            )
            self.db.commit()
            send_after = row1.send_after

            msg2 = self._dealer_message("Второе")
            later = now + timedelta(minutes=1)
            row2 = schedule_chat_email_notification(
                self.db,
                user_id=self.client_user.id,
                chat_id=self.chat.id,
                message_id=msg2.id,
                preview="Второе",
                now=later,
            )
            self.db.commit()

        self.assertEqual(row1.id, row2.id)
        self.assertEqual(row2.target_message_id, msg2.id)
        self.assertEqual(row2.preview, "Второе")
        self.assertEqual(row2.send_after, send_after)

        pending_count = self.db.execute(
            select(ChatEmailNotification).where(
                ChatEmailNotification.status == STATUS_PENDING
            )
        ).scalars().all()
        self.assertEqual(len(pending_count), 1)

    def test_process_cancels_when_read_before_send(self) -> None:
        msg = self._dealer_message()
        now = datetime(2026, 1, 1, 12, 0, 0)
        with patch("app.chat_email_notify.notify_delay_seconds", return_value=0):
            schedule_chat_email_notification(
                self.db,
                user_id=self.client_user.id,
                chat_id=self.chat.id,
                message_id=msg.id,
                preview=msg.text or "",
                now=now,
            )
            self.db.commit()

        self.chat.user_last_read_message_id = msg.id
        self.db.commit()

        with patch("app.chat_email_notify.send_email") as mock_send:
            stats = process_due_chat_email_notifications(self.db, now=now + timedelta(seconds=1))
            mock_send.assert_not_called()

        self.assertEqual(stats["cancelled"], 1)
        self.assertEqual(stats["sent"], 0)
        row = self.db.execute(select(ChatEmailNotification)).scalar_one()
        self.assertEqual(row.status, STATUS_CANCELLED)

    def test_process_sends_once_when_unread(self) -> None:
        msg = self._dealer_message("Расчёт по заявке")
        now = datetime(2026, 1, 1, 12, 0, 0)
        with patch("app.chat_email_notify.notify_delay_seconds", return_value=0):
            schedule_chat_email_notification(
                self.db,
                user_id=self.client_user.id,
                chat_id=self.chat.id,
                message_id=msg.id,
                preview=msg.text or "",
                now=now,
            )
            self.db.commit()

        with patch("app.chat_email_notify.send_email") as mock_send:
            stats = process_due_chat_email_notifications(self.db, now=now + timedelta(seconds=1))
            mock_send.assert_called_once()
            args = mock_send.call_args[0]
            self.assertEqual(args[0], "client@example.com")
            self.assertIn("непрочитанн", args[2].lower())
            self.assertIn(f"chat={self.chat.id}", args[2])

        self.assertEqual(stats["sent"], 1)
        row = self.db.execute(select(ChatEmailNotification)).scalar_one()
        self.assertEqual(row.status, STATUS_SENT)

    def test_cooldown_blocks_reschedule_until_read(self) -> None:
        msg1 = self._dealer_message("Одно")
        now = datetime(2026, 1, 1, 12, 0, 0)
        with patch("app.chat_email_notify.notify_delay_seconds", return_value=0):
            schedule_chat_email_notification(
                self.db,
                user_id=self.client_user.id,
                chat_id=self.chat.id,
                message_id=msg1.id,
                preview="Одно",
                now=now,
            )
            self.db.commit()

        with patch("app.chat_email_notify.send_email"):
            process_due_chat_email_notifications(self.db, now=now + timedelta(seconds=1))

        msg2 = self._dealer_message("Ещё одно пока не прочитал")
        again = schedule_chat_email_notification(
            self.db,
            user_id=self.client_user.id,
            chat_id=self.chat.id,
            message_id=msg2.id,
            preview="Ещё",
            now=now + timedelta(minutes=10),
        )
        self.db.commit()
        self.assertIsNone(again)

        pending = (
            self.db.execute(
                select(ChatEmailNotification).where(
                    ChatEmailNotification.status == STATUS_PENDING
                )
            )
            .scalars()
            .all()
        )
        self.assertEqual(pending, [])

        # После прочтения можно снова поставить pending.
        self.chat.user_last_read_message_id = msg2.id
        self.db.commit()
        msg3 = self._dealer_message("После прочтения")
        with patch("app.chat_email_notify.notify_delay_seconds", return_value=180):
            row = schedule_chat_email_notification(
                self.db,
                user_id=self.client_user.id,
                chat_id=self.chat.id,
                message_id=msg3.id,
                preview="После",
                now=now + timedelta(hours=1),
            )
            self.db.commit()
        self.assertIsNotNone(row)
        self.assertEqual(row.status, STATUS_PENDING)

    def test_skips_guest_chat(self) -> None:
        guest_chat = Chat(
            chat_type="guest",
            user_id=None,
            guest_token="tok-guest-1",
            status="open",
        )
        self.db.add(guest_chat)
        self.db.flush()
        msg = ChatMessage(
            chat_id=guest_chat.id,
            sender_user_id=self.dealer.id,
            message_type="text",
            text="hi",
        )
        self.db.add(msg)
        self.db.commit()
        self.db.refresh(msg)
        row = schedule_chat_email_notification(
            self.db,
            user_id=self.client_user.id,
            chat_id=guest_chat.id,
            message_id=msg.id,
            preview="hi",
        )
        self.assertIsNone(row)


if __name__ == "__main__":
    unittest.main()
