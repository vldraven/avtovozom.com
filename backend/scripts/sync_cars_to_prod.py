"""
Перенос объявлений (cars + car_photos) из одной PostgreSQL в другую.

Сопоставляет марки/модели/поколения по имени и slug. Сохраняет id машин и фото с источника,
чтобы пути /media/cars/{id}/ совпали после rsync медиа.

Запуск из каталога backend:
  export SOURCE_DATABASE_URL="postgresql+psycopg2://USER:PASS@localhost:5432/DB"
  export TARGET_DATABASE_URL="postgresql+psycopg2://USER:PASS@PROD_HOST:5432/DB"
  python -m scripts.sync_cars_to_prod

Либо (как в docker-compose):
  export SOURCE_POSTGRES_HOST=localhost SOURCE_POSTGRES_USER=... SOURCE_POSTGRES_PASSWORD=...
  export TARGET_POSTGRES_HOST=... TARGET_POSTGRES_PASSWORD=...

После скрипта:
  rsync -avz ./media/cars/ USER@HOST:/opt/avtovozom/media/cars/
"""
from __future__ import annotations

import os
import sys
from urllib.parse import quote_plus

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker

if __name__ == "__main__" and not os.environ.get("PYTHONPATH"):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models import (  # noqa: E402
    Car,
    CarBrand,
    CarGeneration,
    CarModel,
    CarPhoto,
    User,
)


def _env_part(key: str, default: str = "") -> str:
    raw = os.getenv(key, default)
    if raw is None:
        return default
    return raw.strip().replace("\r", "").replace("\n", "")


def _database_url_from_env(prefix: str) -> str | None:
    direct_key = "DATABASE_URL" if not prefix else f"{prefix}DATABASE_URL"
    direct = os.getenv(direct_key)
    if direct:
        return _env_part(direct_key)
    p = f"{prefix}POSTGRES_"
    host = _env_part(f"{p}HOST")
    if not host:
        return None
    user = _env_part(f"{p}USER", "avtovozom")
    password = _env_part(f"{p}PASSWORD", "")
    port = _env_part(f"{p}PORT", "5432")
    database = _env_part(f"{p}DB", "avtovozom")
    return (
        f"postgresql+psycopg2://{quote_plus(user)}:{quote_plus(password)}"
        f"@{host}:{port}/{quote_plus(database)}"
    )


def _require_url() -> tuple[str, str]:
    src = _database_url_from_env("SOURCE_")
    tgt = _database_url_from_env("TARGET_")
    if not src:
        raise SystemExit(
            "Задайте SOURCE_DATABASE_URL или SOURCE_POSTGRES_HOST + USER + PASSWORD + DB"
        )
    if not tgt:
        raise SystemExit(
            "Задайте TARGET_DATABASE_URL или TARGET_POSTGRES_HOST + USER + PASSWORD + DB"
        )
    return src, tgt


def _brand_map(src, dst, used_brand_ids: set[int]) -> dict[int, int]:
    locals_ = [
        b
        for b in src.execute(select(CarBrand)).scalars().all()
        if b.id in used_brand_ids
    ]
    prod_by_name = {
        b.name.strip().lower(): b.id for b in dst.execute(select(CarBrand)).scalars().all()
    }
    out: dict[int, int] = {}
    for b in locals_:
        key = b.name.strip().lower()
        pid = prod_by_name.get(key)
        if pid is None:
            raise RuntimeError(
                f"Марка {b.name!r} не найдена на целевой БД. Сначала прогоните seed / каталог."
            )
        out[b.id] = pid
    return out


def _model_map(src, dst, brand_map: dict[int, int], used_model_ids: set[int]) -> dict[int, int]:
    locals_ = [
        m
        for m in src.execute(select(CarModel)).scalars().all()
        if m.id in used_model_ids
    ]
    prod_models = dst.execute(select(CarModel)).scalars().all()
    index: dict[tuple[int, str], int] = {}
    for m in prod_models:
        index[(m.brand_id, m.name.strip().lower())] = m.id
    out: dict[int, int] = {}
    for m in locals_:
        pb = brand_map.get(m.brand_id)
        if pb is None:
            raise RuntimeError(f"Нет сопоставления марки для model id={m.id}")
        key = (pb, m.name.strip().lower())
        pid = index.get(key)
        if pid is None:
            raise RuntimeError(
                f"Модель {m.name!r} для марки id={pb} не найдена на целевой БД."
            )
        out[m.id] = pid
    return out


def _generation_map(
    src, dst, model_map: dict[int, int], used_generation_ids: set[int]
) -> dict[int, int]:
    locals_ = [
        g
        for g in src.execute(select(CarGeneration)).scalars().all()
        if g.id in used_generation_ids
    ]
    prod_gens = dst.execute(select(CarGeneration)).scalars().all()
    index: dict[tuple[int, str], int] = {}
    for g in prod_gens:
        sl = (g.slug or "").strip().lower()
        index[(g.model_id, sl)] = g.id
    out: dict[int, int] = {}
    for g in locals_:
        pm = model_map.get(g.model_id)
        if pm is None:
            raise RuntimeError(f"Нет сопоставления модели для generation id={g.id}")
        sl = (g.slug or "").strip().lower()
        key = (pm, sl)
        pid = index.get(key)
        if pid is None:
            print(
                f"Предупреждение: поколение slug={g.slug!r} model_id={pm} нет на проде — "
                f"объявления с generation_id={g.id} получат NULL."
            )
            continue
        out[g.id] = pid
    return out


def _user_map_by_email(src, dst) -> dict[int, int]:
    lu = src.execute(select(User)).scalars().all()
    prod_by_email = {
        u.email.strip().lower(): u.id for u in dst.execute(select(User)).scalars().all()
    }
    out: dict[int, int] = {}
    for u in lu:
        pid = prod_by_email.get(u.email.strip().lower())
        if pid is not None:
            out[u.id] = pid
    return out


def main() -> None:
    src_url, tgt_url = _require_url()
    src_engine = create_engine(src_url, pool_pre_ping=True)
    tgt_engine = create_engine(tgt_url, pool_pre_ping=True)
    SrcS = sessionmaker(bind=src_engine)
    TgtS = sessionmaker(bind=tgt_engine)

    with SrcS() as src, TgtS() as dst:
        existing_listing_ids = set(
            dst.execute(select(Car.source_listing_id)).scalars().all()
        )
        cars = src.execute(select(Car).order_by(Car.id)).scalars().all()
        used_brand_ids = {c.brand_id for c in cars}
        used_model_ids = {c.model_id for c in cars}
        used_generation_ids = {
            c.generation_id for c in cars if c.generation_id is not None
        }

        brand_map = _brand_map(src, dst, used_brand_ids)
        model_map = _model_map(src, dst, brand_map, used_model_ids)
        gen_map = _generation_map(src, dst, model_map, used_generation_ids)
        user_map = _user_map_by_email(src, dst)
        imported_car_ids: list[int] = []

        for c in cars:
            if c.source_listing_id in existing_listing_ids:
                continue
            bid = brand_map.get(c.brand_id)
            mid = model_map.get(c.model_id)
            if bid is None or mid is None:
                raise RuntimeError(f"Нет сопоставления марки/модели для car id={c.id}")
            gid = gen_map.get(c.generation_id) if c.generation_id is not None else None
            uid = user_map.get(c.created_by_user_id) if c.created_by_user_id else None

            dst.add(
                Car(
                    id=c.id,
                    source=c.source,
                    source_listing_id=c.source_listing_id,
                    brand_id=bid,
                    model_id=mid,
                    generation_id=gid,
                    title=c.title,
                    description=c.description,
                    year=c.year,
                    mileage_km=c.mileage_km,
                    engine_volume_cc=c.engine_volume_cc,
                    horsepower=c.horsepower,
                    fuel_type=c.fuel_type,
                    transmission=c.transmission,
                    location_city=c.location_city,
                    body_color_slug=getattr(c, "body_color_slug", None),
                    price_cny=c.price_cny,
                    registration_date=c.registration_date,
                    production_date=c.production_date,
                    is_active=c.is_active,
                    created_by_user_id=uid,
                    created_at=c.created_at,
                    updated_at=c.updated_at,
                )
            )
            imported_car_ids.append(c.id)
            existing_listing_ids.add(c.source_listing_id)

        dst.commit()

        if not imported_car_ids:
            print("Нет новых объявлений для переноса (все source_listing_id уже есть на проде).")
            return

        photos = (
            src.execute(select(CarPhoto).where(CarPhoto.car_id.in_(imported_car_ids)))
            .scalars()
            .all()
        )
        existing_photo_ids = set(dst.execute(select(CarPhoto.id)).scalars().all())
        for p in photos:
            if p.id in existing_photo_ids:
                continue
            dst.add(
                CarPhoto(
                    id=p.id,
                    car_id=p.car_id,
                    storage_url=p.storage_url,
                    sort_order=p.sort_order,
                )
            )
            existing_photo_ids.add(p.id)

        dst.commit()

        with tgt_engine.connect() as conn:
            conn.execute(
                text(
                    "SELECT setval(pg_get_serial_sequence('cars', 'id'), "
                    "(SELECT COALESCE(MAX(id), 1) FROM cars))"
                )
            )
            conn.execute(
                text(
                    "SELECT setval(pg_get_serial_sequence('car_photos', 'id'), "
                    "(SELECT COALESCE(MAX(id), 1) FROM car_photos))"
                )
            )
            conn.commit()

        print(
            f"Готово: перенесено машин: {len(imported_car_ids)}, фото: {len(photos)}. "
            "Скопируйте media: rsync -avz ./media/cars/ USER@HOST:/opt/avtovozom/media/cars/"
        )


if __name__ == "__main__":
    main()
