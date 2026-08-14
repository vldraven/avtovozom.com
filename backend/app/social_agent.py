"""Agent API для соцсетей: очередь неопубликованных авто и публикация в Telegram."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from .agent_api import verify_agent_secret
from .db import get_db
from .models import Car
from .social_publish import (
    compose_payload,
    get_telegram_publication,
    pending_review_cars,
    publish_telegram_via_n8n,
    queue_item_from_car,
    release_telegram_draft,
    request_telegram_ai_draft,
    unpublished_catalog_cars,
    upsert_telegram_publication,
)

router = APIRouter(prefix="/agent/v1/social", tags=["agent-social"])


class SocialQueueOut(BaseModel):
    count: int
    items: list[dict[str, Any]]


class SocialPublishIn(BaseModel):
    car_id: int
    text: str = Field(..., min_length=1, max_length=12000)
    photo_ids: list[int] | None = None


class SocialPublishOut(BaseModel):
    ok: bool
    status: str | None = None
    detail: str | None = None
    n8n: dict | None = None


class SocialSkipIn(BaseModel):
    car_id: int
    reason: str | None = None


class SocialAiDraftIn(BaseModel):
    car_id: int
    revision: str | None = Field(default=None, max_length=4000)


class SocialAiDraftOut(BaseModel):
    ok: bool
    text: str | None = None
    detail: str | None = None


@router.get("/queue", response_model=SocialQueueOut)
def social_queue(
    limit: int = 40,
    exclude_ids: str | None = Query(default=None, description="Comma-separated car ids to skip"),
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    limit = max(1, min(int(limit or 40), 80))
    excluded: list[int] = []
    if exclude_ids:
        for part in str(exclude_ids).split(","):
            part = part.strip()
            if part.isdigit() and int(part) > 0:
                excluded.append(int(part))
    cars = unpublished_catalog_cars(db, limit=limit, exclude_ids=excluded or None)
    return SocialQueueOut(
        count=len(cars),
        items=[queue_item_from_car(db, car) for car in cars],
    )


@router.get("/pending", response_model=SocialQueueOut)
def social_pending(
    limit: int = 20,
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    limit = max(1, min(int(limit or 20), 40))
    cars = pending_review_cars(db, limit=limit)
    return SocialQueueOut(
        count=len(cars),
        items=[queue_item_from_car(db, car) for car in cars],
    )


@router.get("/cars/{car_id}")
def social_car_compose(
    car_id: int,
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
) -> dict[str, Any]:
    car = (
        db.execute(
            select(Car)
            .options(
                joinedload(Car.brand),
                joinedload(Car.model),
                joinedload(Car.generation),
                joinedload(Car.photos),
            )
            .where(Car.id == car_id, Car.is_active.is_(True))
        )
        .unique()
        .scalar_one_or_none()
    )
    if car is None:
        raise HTTPException(status_code=404, detail="car not found")
    pub = get_telegram_publication(db, car.id)
    payload = compose_payload(db, car)
    payload["telegram_status"] = pub.status if pub else None
    return payload


@router.post("/ai-draft", response_model=SocialAiDraftOut)
def social_ai_draft(
    payload: SocialAiDraftIn,
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    car = (
        db.execute(
            select(Car)
            .options(
                joinedload(Car.brand),
                joinedload(Car.model),
                joinedload(Car.generation),
                joinedload(Car.photos),
            )
            .where(Car.id == payload.car_id, Car.is_active.is_(True))
        )
        .unique()
        .scalar_one_or_none()
    )
    if car is None:
        raise HTTPException(status_code=404, detail="car not found")
    ok, text, err = request_telegram_ai_draft(db, car, revision=payload.revision)
    if not ok:
        return SocialAiDraftOut(ok=False, detail=err)
    return SocialAiDraftOut(ok=True, text=text)


@router.post("/draft", response_model=SocialPublishOut)
def social_mark_draft(
    payload: SocialPublishIn,
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    car = db.get(Car, payload.car_id)
    if car is None or not car.is_active:
        raise HTTPException(status_code=404, detail="car not found")
    pub = get_telegram_publication(db, car.id)
    if pub and pub.status == "published":
        return SocialPublishOut(ok=False, status="published", detail="Уже опубликовано в Telegram")
    upsert_telegram_publication(db, car.id, status="pending_review", text=payload.text)
    return SocialPublishOut(ok=True, status="pending_review")


@router.post("/skip", response_model=SocialPublishOut)
def social_skip(
    payload: SocialSkipIn,
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    car = db.get(Car, payload.car_id)
    if car is None:
        raise HTTPException(status_code=404, detail="car not found")
    pub = get_telegram_publication(db, car.id)
    if pub and pub.status == "published":
        return SocialPublishOut(ok=False, status="published", detail="Уже опубликовано")
    upsert_telegram_publication(
        db,
        car.id,
        status="skipped",
        error=(payload.reason or "")[:500] or None,
    )
    return SocialPublishOut(ok=True, status="skipped")


@router.post("/release", response_model=SocialPublishOut)
def social_release(
    payload: SocialSkipIn,
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    car = db.get(Car, payload.car_id)
    if car is None:
        raise HTTPException(status_code=404, detail="car not found")
    pub = get_telegram_publication(db, car.id)
    if pub and pub.status == "published":
        return SocialPublishOut(ok=False, status="published", detail="Уже опубликовано")
    row = release_telegram_draft(db, car.id, reason=payload.reason)
    if row is None:
        return SocialPublishOut(ok=True, status="released", detail="Не было черновика")
    return SocialPublishOut(ok=True, status="released")


@router.post("/publish", response_model=SocialPublishOut)
def social_publish(
    payload: SocialPublishIn,
    db: Session = Depends(get_db),
    _: None = Depends(verify_agent_secret),
):
    car = (
        db.execute(
            select(Car)
            .options(
                joinedload(Car.brand),
                joinedload(Car.model),
                joinedload(Car.generation),
                joinedload(Car.photos),
            )
            .where(Car.id == payload.car_id, Car.is_active.is_(True))
        )
        .unique()
        .scalar_one_or_none()
    )
    if car is None:
        raise HTTPException(status_code=404, detail="car not found")
    pub = get_telegram_publication(db, car.id)
    if pub and pub.status == "published":
        return SocialPublishOut(ok=False, status="published", detail="Уже опубликовано в Telegram")

    data = compose_payload(db, car)
    wanted = payload.photo_ids if payload.photo_ids else data["photo_ids"]
    by_id = {p["id"]: p["absolute_url"] for p in data["photos"]}
    photo_urls: list[str] = []
    seen: set[int] = set()
    for pid in wanted:
        if pid in seen or pid not in by_id:
            continue
        seen.add(pid)
        photo_urls.append(by_id[pid])

    ok, n8n_dict, err = publish_telegram_via_n8n(
        car_id=car.id,
        listing_web_url=data["canonical_web_url"],
        text=payload.text.strip(),
        photo_urls=photo_urls,
    )
    if not ok:
        upsert_telegram_publication(
            db, car.id, status="error", text=payload.text, error=err
        )
        return SocialPublishOut(ok=False, status="error", detail=err, n8n=n8n_dict)

    upsert_telegram_publication(db, car.id, status="published", text=payload.text)
    return SocialPublishOut(ok=True, status="published", n8n=n8n_dict)
