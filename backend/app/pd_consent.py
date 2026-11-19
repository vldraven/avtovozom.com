"""Запись отдельных согласий на обработку и распространение ПДн.

Версия должна совпадать с web/lib/pdConsent.js (PD_CONSENT_VERSION).
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from .db import get_db
from .models import PdConsentLog, User
from .security import decode_access_token

CONSENT_VERSION = "2026-11-18"

_oauth = OAuth2PasswordBearer(tokenUrl="/auth/login")
router = APIRouter(tags=["pd-consents"])


def client_ip(request: Request | None) -> str:
    if request is None:
        return ""
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if forwarded:
        return forwarded[:64]
    if request.client and request.client.host:
        return request.client.host[:64]
    return ""


def _user_agent(request: Request | None) -> str:
    if request is None:
        return ""
    return (request.headers.get("user-agent") or "")[:256]


def validate_processing_consent(
    *,
    pd_consent: bool,
    consent_version: str,
    terms_accepted: bool = False,
    require_terms: bool = False,
) -> None:
    if (consent_version or "").strip() != CONSENT_VERSION:
        raise HTTPException(
            status_code=400,
            detail="Редакция согласия обновилась. Обновите страницу и подтвердите её заново.",
        )
    if not pd_consent:
        raise HTTPException(
            status_code=400,
            detail="Нужно отдельное согласие на обработку персональных данных.",
        )
    if require_terms and not terms_accepted:
        raise HTTPException(
            status_code=400,
            detail="Нужно отдельно принять пользовательское соглашение.",
        )


def _existing(
    db: Session,
    *,
    form_code: str,
    user_id: int | None = None,
    guest_token: str | None = None,
) -> PdConsentLog | None:
    stmt = select(PdConsentLog).where(
        PdConsentLog.form_code == form_code,
        PdConsentLog.document_version == CONSENT_VERSION,
        PdConsentLog.accepted.is_(True),
    )
    if user_id is not None:
        stmt = stmt.where(PdConsentLog.user_id == user_id)
    elif guest_token:
        stmt = stmt.where(PdConsentLog.guest_token == guest_token)
    else:
        return None
    return db.execute(stmt.limit(1)).scalar_one_or_none()


def record_consent(
    db: Session,
    request: Request | None,
    *,
    form_code: str,
    accepted: bool = True,
    email: str | None = None,
    phone: str | None = None,
    user_id: int | None = None,
    guest_token: str | None = None,
    note: str | None = None,
) -> None:
    if accepted and form_code in {"guest_chat", "blog_distribution"}:
        if _existing(db, form_code=form_code, user_id=user_id, guest_token=guest_token):
            return
    row = PdConsentLog(
        form_code=form_code[:32],
        document_version=CONSENT_VERSION,
        accepted=accepted,
        subject_email=(email or "").strip().lower()[:255] or None,
        subject_phone=(phone or "").strip()[:32] or None,
        user_id=user_id,
        guest_token=(guest_token or "").strip()[:64] or None,
        ip=client_ip(request),
        user_agent=_user_agent(request),
        note=(note or "").strip()[:2000] or None,
    )
    db.add(row)
    db.flush()


def ensure_distribution_consent(
    db: Session,
    request: Request | None,
    *,
    user: User,
    distribution_consent: bool,
    consent_version: str,
) -> None:
    if _existing(db, form_code="blog_distribution", user_id=user.id):
        return
    if not distribution_consent or (consent_version or "").strip() != CONSENT_VERSION:
        raise HTTPException(
            status_code=400,
            detail="Нужно отдельное согласие на публикацию имени и текста на сайте.",
        )
    record_consent(
        db,
        request,
        form_code="blog_distribution",
        email=user.email,
        phone=user.phone,
        user_id=user.id,
    )


def _admin_user(token: str, db: Session) -> User:
    user_id = decode_access_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = (
        db.execute(select(User).where(User.id == int(user_id)).options(joinedload(User.role)))
        .unique()
        .scalar_one_or_none()
    )
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if not user.role or user.role.code != "admin":
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return user


def _auth_user(token: str, db: Session) -> User:
    user_id = decode_access_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = db.execute(select(User).where(User.id == int(user_id))).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user


class CookieConsentIn(BaseModel):
    choice: str = ""
    consent_version: str = ""


class WithdrawalIn(BaseModel):
    email: str
    phone: str = ""
    comment: str = ""


class ConsentStatusOut(BaseModel):
    blog_distribution: bool = False


class PdConsentLogOut(BaseModel):
    id: int
    created_at: datetime
    form_code: str
    document_version: str
    accepted: bool
    subject_email: str | None = None
    subject_phone: str | None = None
    user_id: int | None = None
    guest_token: str | None = None
    ip: str | None = None
    note: str | None = None

    class Config:
        from_attributes = True


@router.get("/public/pd-consents/status", response_model=ConsentStatusOut)
def consent_status(token: str = Depends(_oauth), db: Session = Depends(get_db)):
    user = _auth_user(token, db)
    granted = _existing(db, form_code="blog_distribution", user_id=user.id) is not None
    return ConsentStatusOut(blog_distribution=granted)


@router.post("/public/pd-consents/cookies")
def record_cookie_choice(payload: CookieConsentIn, request: Request, db: Session = Depends(get_db)):
    choice = (payload.choice or "").strip()
    if choice not in {"accepted", "declined"}:
        raise HTTPException(status_code=400, detail="Неизвестный выбор cookies")
    if (payload.consent_version or "").strip() != CONSENT_VERSION:
        raise HTTPException(status_code=400, detail="Редакция согласия обновилась. Обновите страницу.")
    record_consent(
        db,
        request,
        form_code="cookies",
        accepted=choice == "accepted",
        note=choice,
    )
    db.commit()
    return {"ok": True}


@router.post("/public/pd-consents/withdrawal")
def withdraw_consent(payload: WithdrawalIn, request: Request, db: Session = Depends(get_db)):
    email = (payload.email or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Укажите email, на который можно ответить")
    comment = (payload.comment or "").strip()
    record_consent(
        db,
        request,
        form_code="withdrawal",
        accepted=False,
        email=email,
        phone=payload.phone,
        note=comment or "Отзыв согласия на обработку персональных данных",
    )
    db.commit()
    return {
        "ok": True,
        "message": "Запрос принят. Оператор рассмотрит его и ответит на указанный email.",
    }


@router.get("/admin/pd-consents", response_model=list[PdConsentLogOut])
def list_pd_consents(
    form_code: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=300),
    token: str = Depends(_oauth),
    db: Session = Depends(get_db),
):
    _admin_user(token, db)
    stmt = select(PdConsentLog).order_by(PdConsentLog.id.desc()).limit(limit)
    code = (form_code or "").strip()
    if code:
        stmt = select(PdConsentLog).where(PdConsentLog.form_code == code).order_by(PdConsentLog.id.desc()).limit(limit)
    rows = db.execute(stmt).scalars().all()
    return rows
