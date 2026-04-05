import logging
import os
import smtplib
from email.message import EmailMessage

logger = logging.getLogger(__name__)


def send_email(to_email: str, subject: str, body: str) -> None:
    host = os.getenv("SMTP_HOST", "").strip()
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER", "").strip()
    password = os.getenv("SMTP_PASSWORD", "").strip()
    from_email = os.getenv("SMTP_FROM", user or "no-reply@avtovozom.local")
    if not host:
        # Без SMTP_HOST письма не уходят наружу — только в лог бэкенда (см. docker logs).
        logger.warning(
            "SMTP_HOST не задан: реальная отправка отключена. Получатель: %s, тема: %s",
            to_email,
            subject,
        )
        logger.info("[email:dry-run]\n%s", body)
        print(f"[email:dry-run] to={to_email} subj={subject}\n{body}\n", flush=True)
        return

    msg = EmailMessage()
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body)

    if port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=30) as smtp:
            if user:
                smtp.login(user, password)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=30) as smtp:
            smtp.starttls()
            if user:
                smtp.login(user, password)
            smtp.send_message(msg)
