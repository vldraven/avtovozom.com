"""Обзорный режим: публичный сайт остаётся читаемым, новый приём ПДн закрыт."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session, joinedload

from .app_settings import get_setting, set_setting
from .db import get_db
from .models import User
from .security import decode_access_token

REVIEW_MODE_KEY = "review_mode"
REVIEW_MODE_BY_KEY = "review_mode_updated_by"
REVIEW_MODE_DETAIL = "Сайт в обзорном режиме: приём обращений временно закрыт."

_oauth = OAuth2PasswordBearer(tokenUrl="/auth/login")
router = APIRouter(tags=["site-mode"])


def is_review_mode(db: Session) -> bool:
    try:
        return get_setting(db, REVIEW_MODE_KEY).strip() == "1"
    except (OperationalError, ProgrammingError):
        db.rollback()
        return False


def assert_public_intake_open(db: Session) -> None:
    if is_review_mode(db):
        raise HTTPException(status_code=403, detail=REVIEW_MODE_DETAIL)


def assert_user_allowed(db: Session, user: User) -> None:
    if not is_review_mode(db):
        return
    role = user.role.code if user.role else ""
    if role != "admin":
        raise HTTPException(status_code=403, detail=REVIEW_MODE_DETAIL)


def set_review_mode(db: Session, enabled: bool, user_id: int) -> None:
    set_setting(db, REVIEW_MODE_KEY, "1" if enabled else "0")
    set_setting(db, REVIEW_MODE_BY_KEY, str(user_id))


def _admin(token: str, db: Session) -> User:
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


class SiteModeOut(BaseModel):
    review_mode: bool
    updated_by: str = ""


class SiteModeIn(BaseModel):
    review_mode: bool


@router.get("/public/site-mode", response_model=SiteModeOut)
def public_site_mode(db: Session = Depends(get_db)):
    return SiteModeOut(review_mode=is_review_mode(db))


@router.get("/admin/site-mode", response_model=SiteModeOut)
def admin_get_site_mode(token: str = Depends(_oauth), db: Session = Depends(get_db)):
    _admin(token, db)
    return SiteModeOut(
        review_mode=is_review_mode(db),
        updated_by=get_setting(db, REVIEW_MODE_BY_KEY),
    )


@router.put("/admin/site-mode", response_model=SiteModeOut)
def admin_set_site_mode(
    payload: SiteModeIn,
    token: str = Depends(_oauth),
    db: Session = Depends(get_db),
):
    admin = _admin(token, db)
    set_review_mode(db, payload.review_mode, admin.id)
    db.commit()
    return SiteModeOut(review_mode=payload.review_mode, updated_by=str(admin.id))
