from collections.abc import Callable
from datetime import datetime
import os

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, joinedload

from .che168_parser import (
    ParsedCar,
    car_source_for_marketplace,
    fetch_autohome_spec_id_from_detail_url,
    filter_vehicle_photo_urls,
    incomplete_listing_parse_message,
    marketplace_from_detail_url,
    normalize_import_detail_url,
    parse_che168_detail,
    parse_che168_listing_links,
    source_listing_id_from_url,
)
from .listing_copy_ru import basic_neutral_description_ru, pick_listing_title
from .indexnow import submit_car as _indexnow_submit_car
from .body_colors import label_for_slug
from .media_storage import delete_car_photo_files, download_car_photos
from .models import Car, CarGeneration, CarPhoto, CarModel, ModelWhitelist, ParseJob
from .model_resolver import resolve_model_id_for_listing
from .parser_cancellation import clear_cancel, is_cancel_requested
from .parser_timeout import ParserJobCancelled, call_with_cancel_poll, call_with_timeout
from .translator_ru import translate_to_ru
from .trim_catalog import pick_generation_id_for_car, resolve_trim_for_listing


def _finalize_job_cancelled(
    db: Session,
    job: ParseJob,
    *,
    total_processed: int = 0,
    total_created: int = 0,
    total_updated: int = 0,
    total_errors: int = 0,
    message: str | None = None,
) -> ParseJob:
    job.status = "cancelled"
    job.finished_at = datetime.utcnow()
    job.total_processed = total_processed
    job.total_created = total_created
    job.total_updated = total_updated
    job.total_errors = total_errors
    if message:
        job.message = message[:500]
    elif not (job.message or "").strip():
        job.message = "Остановлено пользователем."
    elif "Остановлено" not in job.message:
        job.message = f"{job.message} · Остановлено пользователем."[:500]
    db.commit()
    db.refresh(job)
    clear_cancel(job.id)
    return job


def _job_cancel_requested(db: Session, job_id: int) -> bool:
    if is_cancel_requested(job_id):
        return True
    val = db.execute(select(ParseJob.cancel_requested).where(ParseJob.id == job_id)).scalar_one_or_none()
    return bool(val)


def _stop_if_cancelled(
    db: Session,
    job: ParseJob,
    *,
    total_processed: int = 0,
    total_created: int = 0,
    total_updated: int = 0,
    total_errors: int = 0,
) -> bool:
    if not _job_cancel_requested(db, job.id):
        return False
    _finalize_job_cancelled(
        db,
        job,
        total_processed=total_processed,
        total_created=total_created,
        total_updated=total_updated,
        total_errors=total_errors,
    )
    return True


def _resolve_preferred_generation_id(
    db: Session,
    *,
    model_id: int,
    year: int | None,
    preferred_generation_id: int | None,
) -> int | None:
    if preferred_generation_id is not None:
        gen = db.get(CarGeneration, preferred_generation_id)
        if gen is not None and gen.model_id == model_id:
            return gen.id
    return pick_generation_id_for_car(db, model_id, year)


def _apply_trim_from_parsed(
    db: Session,
    car: Car,
    *,
    model_id: int,
    parsed: ParsedCar,
    preferred_generation_id: int | None = None,
) -> None:
    generation_id = _resolve_preferred_generation_id(
        db,
        model_id=model_id,
        year=parsed.year,
        preferred_generation_id=preferred_generation_id,
    )
    if generation_id is not None:
        car.generation_id = generation_id

    if not parsed.autohome_spec_id:
        return
    trim_id = resolve_trim_for_listing(
        db,
        model_id=model_id,
        year=parsed.year,
        autohome_spec_id=parsed.autohome_spec_id,
        preferred_generation_id=generation_id,
    )
    if trim_id:
        car.trim_id = trim_id


def _ensure_autohome_spec_id(parsed: ParsedCar, detail_url: str, marketplace: str) -> None:
    """Если разбор не дал specId — добрать лёгким HTTP (как backfill-trims)."""
    if parsed.autohome_spec_id or marketplace == "dongchedi":
        return
    sid = fetch_autohome_spec_id_from_detail_url(detail_url)
    if sid:
        parsed.autohome_spec_id = sid


def _insert_car_from_parsed(
    db: Session,
    model: CarModel,
    parsed: ParsedCar,
    download_timeout: float,
    progress_cb: Callable[[str], None] | None = None,
    car_source: str = "che168",
    preferred_generation_id: int | None = None,
) -> tuple[Car | None, str | None]:
    resolved_model_id = resolve_model_id_for_listing(
        db,
        brand_name=model.brand.name,
        brand_id=model.brand_id,
        fallback_model_id=model.id,
        title=parsed.title,
        description=parsed.description,
        series_raw=parsed.series_raw,
    )
    resolved_row = db.get(CarModel, resolved_model_id)
    display_model_name = resolved_row.name if resolved_row else model.name

    fuel_ru = translate_to_ru(parsed.fuel_type) if parsed.fuel_type else None
    trans_ru = translate_to_ru(parsed.transmission) if parsed.transmission else None
    city_ru = translate_to_ru(parsed.location_city) if parsed.location_city else None

    # Title: Brand Model Trim на латинице — без перевода на русский
    title_en = pick_listing_title(
        model.brand.name,
        display_model_name,
        parsed.year or 2020,
        parsed.title,
        series_raw=parsed.series_raw,
    )
    desc_ru = basic_neutral_description_ru(
        model.brand.name,
        display_model_name,
        parsed.year or 2020,
        parsed.mileage_km,
        parsed.engine_volume_cc,
        parsed.horsepower,
        fuel_ru,
        trans_ru,
        city_ru,
        body_color_label=label_for_slug(parsed.body_color_slug),
    )

    car = Car(
        source=(car_source or "che168")[:32],
        source_listing_id=parsed.source_listing_id,
        brand_id=model.brand_id,
        model_id=resolved_model_id,
        title=title_en,
        description=desc_ru,
        year=parsed.year or 2020,
        engine_volume_cc=parsed.engine_volume_cc or 0,
        horsepower=parsed.horsepower or 0,
        mileage_km=parsed.mileage_km,
        fuel_type=fuel_ru,
        transmission=trans_ru,
        location_city=city_ru,
        body_color_slug=parsed.body_color_slug,
        price_cny=parsed.price_cny if parsed.price_cny is not None else 0.01,
        registration_date=parsed.registration_date,
        production_date=parsed.production_date,
    )
    _apply_trim_from_parsed(
        db,
        car,
        model_id=resolved_model_id,
        parsed=parsed,
        preferred_generation_id=preferred_generation_id,
    )
    db.add(car)
    db.flush()
    if progress_cb:
        progress_cb("3/3 Загрузка фото на сервер…")
    photo_urls = filter_vehicle_photo_urls(list(parsed.photos or []))
    try:
        local_urls = call_with_timeout(
            lambda: download_car_photos(car.id, photo_urls),
            timeout_sec=download_timeout,
        )
    except Exception as e:
        db.rollback()
        return None, str(e)

    for i, storage_url in enumerate(local_urls):
        if not storage_url:
            continue
        db.add(
            CarPhoto(
                car_id=car.id,
                storage_url=storage_url,
                sort_order=i,
            )
        )
    db.commit()
    db.refresh(car)
    _indexnow_submit_car(db, car)
    return car, None


def _revive_inactive_car_from_parsed(
    db: Session,
    car: Car,
    model: CarModel,
    parsed: ParsedCar,
    download_timeout: float,
    progress_cb: Callable[[str], None] | None = None,
    car_source: str = "che168",
    preferred_generation_id: int | None = None,
) -> tuple[Car | None, str | None]:
    """
    То же содержание карточки, что при новом импорте: обновляет поля, меняет фото,
    выставляет is_active=True (после «удаления» из каталога остаётся строка с тем же source_listing_id).
    """
    resolved_model_id = resolve_model_id_for_listing(
        db,
        brand_name=model.brand.name,
        brand_id=model.brand_id,
        fallback_model_id=model.id,
        title=parsed.title,
        description=parsed.description,
        series_raw=parsed.series_raw,
    )
    resolved_row = db.get(CarModel, resolved_model_id)
    display_model_name = resolved_row.name if resolved_row else model.name

    fuel_ru = translate_to_ru(parsed.fuel_type) if parsed.fuel_type else None
    trans_ru = translate_to_ru(parsed.transmission) if parsed.transmission else None
    city_ru = translate_to_ru(parsed.location_city) if parsed.location_city else None

    title_en = pick_listing_title(
        model.brand.name,
        display_model_name,
        parsed.year or 2020,
        parsed.title,
        series_raw=parsed.series_raw,
    )
    desc_ru = basic_neutral_description_ru(
        model.brand.name,
        display_model_name,
        parsed.year or 2020,
        parsed.mileage_km,
        parsed.engine_volume_cc,
        parsed.horsepower,
        fuel_ru,
        trans_ru,
        city_ru,
        body_color_label=label_for_slug(parsed.body_color_slug),
    )

    car.source = (car_source or "che168")[:32]
    car.brand_id = model.brand_id
    car.model_id = resolved_model_id
    car.title = title_en
    car.description = desc_ru
    car.year = parsed.year or 2020
    car.engine_volume_cc = parsed.engine_volume_cc or 0
    car.horsepower = parsed.horsepower or 0
    car.mileage_km = parsed.mileage_km
    car.fuel_type = fuel_ru
    car.transmission = trans_ru
    car.location_city = city_ru
    car.body_color_slug = parsed.body_color_slug
    car.price_cny = parsed.price_cny if parsed.price_cny is not None else 0.01
    car.registration_date = parsed.registration_date
    car.production_date = parsed.production_date
    car.is_active = True
    _apply_trim_from_parsed(
        db,
        car,
        model_id=resolved_model_id,
        parsed=parsed,
        preferred_generation_id=preferred_generation_id,
    )

    old_urls = list(
        db.execute(select(CarPhoto.storage_url).where(CarPhoto.car_id == car.id)).scalars().all()
    )
    db.execute(delete(CarPhoto).where(CarPhoto.car_id == car.id))
    db.flush()
    delete_car_photo_files(car.id, old_urls)

    if progress_cb:
        progress_cb("3/3 Загрузка фото на сервер…")
    photo_urls = filter_vehicle_photo_urls(list(parsed.photos or []))
    try:
        local_urls = call_with_timeout(
            lambda: download_car_photos(car.id, photo_urls),
            timeout_sec=download_timeout,
        )
    except Exception as e:
        db.rollback()
        return None, str(e)

    for i, storage_url in enumerate(local_urls):
        if not storage_url:
            continue
        db.add(
            CarPhoto(
                car_id=car.id,
                storage_url=storage_url,
                sort_order=i,
            )
        )
    db.commit()
    db.refresh(car)
    _indexnow_submit_car(db, car)
    return car, None


def _run_single_listing_import(db: Session, job: ParseJob) -> ParseJob:
    """Импорт одной карточки по import_model_id + import_detail_url (без обхода списка витрины)."""
    total_created = 0
    total_updated = 0
    total_processed = 0
    total_errors = 0
    download_timeout = float(os.getenv("CHE168_DOWNLOAD_PHOTOS_TIMEOUT_SEC", "90"))

    def flush_progress(msg: str | None = None) -> None:
        job.total_processed = total_processed
        job.total_created = total_created
        job.total_updated = total_updated
        job.total_errors = total_errors
        if msg is not None:
            job.message = msg
        db.commit()
        db.refresh(job)

    job.status = "running"
    job.started_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    if _stop_if_cancelled(
        db,
        job,
        total_processed=total_processed,
        total_created=total_created,
        total_updated=total_updated,
        total_errors=total_errors,
    ):
        return job

    demo_rows = (
        db.execute(select(Car).where(Car.source_listing_id.like("demo-%"))).scalars().all()
    )
    for row in demo_rows:
        row.is_active = False
    db.commit()

    mid = job.import_model_id
    raw_url = (job.import_detail_url or "").strip()
    preferred_generation_id = getattr(job, "import_generation_id", None)
    if mid is None or not raw_url:
        job.status = "failed"
        job.finished_at = datetime.utcnow()
        job.message = "Не указаны модель или ссылка на объявление."
        db.commit()
        db.refresh(job)
        return job

    detail_url = normalize_import_detail_url(raw_url)
    if not detail_url:
        job.status = "failed"
        job.finished_at = datetime.utcnow()
        job.message = (
            "Нужна прямая ссылка: che168 — …/dealer/…/….html, i.che168.com/car/… "
            "или m.che168.com/cardetail?infoid=…; "
            "global.che168 — …/detail/…; dongchedi — …/usedcar/…"
        )
        db.commit()
        db.refresh(job)
        return job

    mp = marketplace_from_detail_url(detail_url)
    car_src = car_source_for_marketplace(mp)

    model = db.execute(
        select(CarModel).options(joinedload(CarModel.brand)).where(CarModel.id == mid)
    ).scalar_one_or_none()
    if not model or not model.brand:
        job.status = "failed"
        job.finished_at = datetime.utcnow()
        job.message = "Модель не найдена."
        db.commit()
        db.refresh(job)
        return job

    wl = db.execute(select(ModelWhitelist).where(ModelWhitelist.model_id == mid)).scalar_one_or_none()
    if not wl:
        db.add(ModelWhitelist(model_id=mid, enabled=True))
    else:
        wl.enabled = True
    if mp == "che168":
        model.che168_url = detail_url
    db.commit()
    db.refresh(model)

    existing_ids = set(
        db.execute(
            select(Car.source_listing_id).where(
                Car.source_listing_id.isnot(None),
                Car.is_active.is_(True),
            )
        ).scalars().all()
    )

    try:
        try:
            sid = source_listing_id_from_url(detail_url)
        except ValueError as e:
            job.status = "failed"
            job.message = (str(e) or "Некорректная ссылка")[:500]
            job.finished_at = datetime.utcnow()
            db.commit()
            db.refresh(job)
            return job

        if sid in existing_ids:
            existing_car = db.execute(
                select(Car).where(
                    Car.source_listing_id == sid,
                    Car.is_active.is_(True),
                )
            ).scalar_one_or_none()
            total_processed = 1
            # Если объявление уже есть, но без комплектации — дозагружаем trim/поколение.
            if existing_car and (existing_car.trim_id is None or existing_car.generation_id is None):
                flush_progress("Дозагрузка комплектации для существующего объявления…")
                try:
                    parsed_exist = call_with_timeout(
                        lambda: parse_che168_detail(detail_url),
                        timeout_sec=float(os.getenv("CHE168_DETAIL_PARSE_TIMEOUT_SEC", "180")),
                    )
                    _ensure_autohome_spec_id(parsed_exist, detail_url, mp)
                    _apply_trim_from_parsed(
                        db,
                        existing_car,
                        model_id=existing_car.model_id or mid,
                        parsed=parsed_exist,
                        preferred_generation_id=preferred_generation_id,
                    )
                    db.commit()
                    db.refresh(existing_car)
                except Exception:
                    pass
                if existing_car.trim_id:
                    job.message = (
                        f"Объявление #{existing_car.id} уже было в каталоге; комплектация обновлена."
                    )[:512]
                else:
                    job.message = "Это объявление уже есть в каталоге."
            else:
                job.message = "Это объявление уже есть в каталоге."
            job.finished_at = datetime.utcnow()
            job.total_processed = total_processed
            job.total_created = 0
            job.total_updated = total_updated
            job.total_errors = total_errors
            job.status = "success"
            db.commit()
            db.refresh(job)
            return job

        def abort_import_if_cancelled() -> bool:
            return _stop_if_cancelled(
                db,
                job,
                total_processed=total_processed,
                total_created=total_created,
                total_updated=total_updated,
                total_errors=total_errors,
            )

        flush_progress("1/3 Загрузка страницы объявления…")
        if abort_import_if_cancelled():
            return job
        try:
            parsed = call_with_cancel_poll(
                lambda: parse_che168_detail(detail_url),
                should_cancel=abort_import_if_cancelled,
            )
        except ParserJobCancelled:
            return job
        except Exception as e:
            total_errors = 1
            total_processed = 1
            job.status = "failed"
            job.message = str(e)[:500]
            job.finished_at = datetime.utcnow()
            job.total_processed = total_processed
            job.total_created = total_created
            job.total_updated = total_updated
            job.total_errors = total_errors
            db.commit()
            db.refresh(job)
            return job

        incomplete_reason = incomplete_listing_parse_message(parsed)
        if incomplete_reason:
            total_errors = 1
            total_processed = 1
            job.status = "failed"
            job.message = f"Неполный разбор объявления: {incomplete_reason}"[:500]
            job.finished_at = datetime.utcnow()
            job.total_processed = total_processed
            job.total_created = total_created
            job.total_updated = total_updated
            job.total_errors = total_errors
            db.commit()
            db.refresh(job)
            return job

        _ensure_autohome_spec_id(parsed, detail_url, mp)
        total_processed = 1
        flush_progress("2/3 Сохранение объявления в каталог…")

        car = db.execute(
            select(Car).where(Car.source_listing_id == parsed.source_listing_id)
        ).scalar_one_or_none()
        if car and car.is_active:
            _apply_trim_from_parsed(
                db,
                car,
                model_id=car.model_id or mid,
                parsed=parsed,
                preferred_generation_id=preferred_generation_id,
            )
            db.commit()
            db.refresh(car)
            job.finished_at = datetime.utcnow()
            job.total_processed = total_processed
            job.total_created = 0
            job.total_updated = total_updated
            job.total_errors = total_errors
            job.status = "success"
            if car.trim_id:
                job.message = (
                    f"Объявление #{car.id} уже было в каталоге; комплектация обновлена."
                )[:512]
            else:
                job.message = "Это объявление уже есть в каталоге."
            db.commit()
            db.refresh(job)
            return job

        if car and not car.is_active:
            car_new, err = _revive_inactive_car_from_parsed(
                db,
                car,
                model,
                parsed,
                download_timeout,
                progress_cb=lambda m: flush_progress(m),
                car_source=car_src,
                preferred_generation_id=preferred_generation_id,
            )
            if err:
                total_errors = 1
                job.status = "failed"
                job.message = f"Не удалось восстановить объявление: {err}"[:500]
                job.finished_at = datetime.utcnow()
                job.total_processed = total_processed
                job.total_created = total_created
                job.total_updated = total_updated
                job.total_errors = total_errors
                db.commit()
                db.refresh(job)
                return job

            total_updated = 1
            job.finished_at = datetime.utcnow()
            job.total_processed = total_processed
            job.total_created = total_created
            job.total_updated = total_updated
            job.total_errors = total_errors
            job.status = "success"
            trim_note = " с комплектацией" if car_new and car_new.trim_id else ""
            job.message = (
                f"Объявление восстановлено #{car_new.id}: {model.brand.name} {model.name}.{trim_note}"
            )[:512]
            db.commit()
            db.refresh(job)
            return job

        car_new, err = _insert_car_from_parsed(
            db,
            model,
            parsed,
            download_timeout,
            progress_cb=lambda m: flush_progress(m),
            car_source=car_src,
            preferred_generation_id=preferred_generation_id,
        )
        if err:
            total_errors = 1
            job.status = "failed"
            job.message = f"Не удалось сохранить объявление: {err}"[:500]
            job.finished_at = datetime.utcnow()
            job.total_processed = total_processed
            job.total_created = total_created
            job.total_updated = total_updated
            job.total_errors = total_errors
            db.commit()
            db.refresh(job)
            return job

        total_created = 1
        job.finished_at = datetime.utcnow()
        job.total_processed = total_processed
        job.total_created = total_created
        job.total_updated = total_updated
        job.total_errors = total_errors
        job.status = "success"
        trim_note = " Комплектация подтянута." if car_new and car_new.trim_id else ""
        job.message = (
            f"Добавлено объявление #{car_new.id}: {model.brand.name} {model.name}.{trim_note}"
        )[:512]
        db.commit()
        db.refresh(job)
        return job

    except Exception as e:
        job.status = "failed"
        job.message = str(e)[:500]
        job.finished_at = datetime.utcnow()
        job.total_processed = total_processed
        job.total_created = total_created
        job.total_updated = total_updated
        job.total_errors = total_errors
        db.commit()
        db.refresh(job)
        return job
    finally:
        if job.finished_at is None:
            job.finished_at = datetime.utcnow()
            job.total_processed = total_processed
            job.total_created = total_created
            job.total_updated = total_updated
            job.total_errors = total_errors
            if job.status == "running":
                job.status = "failed"
                job.message = (job.message or "Прервано без сообщения")[:500]
            elif job.status == "cancelled":
                pass
            db.commit()
            db.refresh(job)


def run_parser_job(db: Session, job: ParseJob) -> ParseJob:
    if job.import_model_id is not None and (job.import_detail_url or "").strip():
        return _run_single_listing_import(db, job)

    job.status = "running"
    job.started_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    if _stop_if_cancelled(db, job):
        return job

    # Убираем демо-данные, чтобы было видно реальную работу парсера.
    demo_rows = (
        db.execute(select(Car).where(Car.source_listing_id.like("demo-%"))).scalars().all()
    )
    for row in demo_rows:
        row.is_active = False
    db.commit()

    whitelist_models = (
        db.execute(
            select(ModelWhitelist)
            .options(
                joinedload(ModelWhitelist.model).joinedload(CarModel.brand),
            )
            .where(ModelWhitelist.enabled.is_(True))
        )
        .scalars()
        .all()
    )

    if not whitelist_models:
        job.status = "failed"
        job.finished_at = datetime.utcnow()
        job.message = "Whitelist is empty. Enable at least one model."
        db.commit()
        db.refresh(job)
        return job

    total_created = 0
    total_updated = 0
    total_processed = 0
    total_errors = 0

    max_links = int(os.getenv("CHE168_MAX_LINKS_PER_MODEL", "40"))
    max_new = int(os.getenv("CHE168_NEW_PER_RUN", "5"))
    download_timeout = float(os.getenv("CHE168_DOWNLOAD_PHOTOS_TIMEOUT_SEC", "90"))

    def flush_progress(msg: str | None = None) -> None:
        job.total_processed = total_processed
        job.total_created = total_created
        job.total_updated = total_updated
        job.total_errors = total_errors
        if msg is not None:
            job.message = msg
        db.commit()
        db.refresh(job)

    def abort_if_cancelled() -> bool:
        return _stop_if_cancelled(
            db,
            job,
            total_processed=total_processed,
            total_created=total_created,
            total_updated=total_updated,
            total_errors=total_errors,
        )

    force_urls = os.getenv("CHE168_FORCE_DETAIL_URLS", "").strip()
    if force_urls:
        whitelist_models = whitelist_models[:1]

    existing_ids = set(
        db.execute(
            select(Car.source_listing_id).where(
                Car.source_listing_id.isnot(None),
                Car.is_active.is_(True),
            )
        ).scalars().all()
    )

    try:
        for wl in whitelist_models:
            if abort_if_cancelled():
                return job
            model: CarModel = wl.model
            if not model.che168_url and not force_urls:
                continue

            job.status = "running"
            flush_progress(f"{model.name}: открываю список на che168…")
            if abort_if_cancelled():
                return job

            links = []
            list_timeout = float(os.getenv("CHE168_PARSE_LIST_TIMEOUT_SEC", "180"))
            try:
                series_placeholder = model.che168_url or "https://www.che168.com/"
                links = call_with_cancel_poll(
                    lambda url=series_placeholder: parse_che168_listing_links(url, max_items=max_links),
                    should_cancel=abort_if_cancelled,
                    timeout_sec=list_timeout,
                )
            except ParserJobCancelled:
                return job
            except Exception as e:
                total_errors += 1
                flush_progress(f"Ошибка ссылок для {model.name}: {e}")
                if abort_if_cancelled():
                    return job
                continue

            if not links:
                flush_progress(
                    f"{model.name}: ссылок на объявления не найдено (пустой список или недоступен сайт)."
                )
                if abort_if_cancelled():
                    return job
                continue

            new_links: list[str] = []
            for url in links:
                try:
                    sid = source_listing_id_from_url(url)
                except ValueError:
                    continue
                if sid in existing_ids:
                    continue
                new_links.append(url)
                if len(new_links) >= max_new:
                    break

            if not new_links:
                flush_progress(
                    f"{model.name}: новых объявлений нет (все {len(links)} из выборки уже в каталоге)."
                )
                if abort_if_cancelled():
                    return job
                continue

            flush_progress(
                f"{model.name}: к разбору {len(new_links)} новых объявлений (макс. {max_new} за запуск)."
            )
            if abort_if_cancelled():
                return job

            details_count = 0
            for detail_url in new_links:
                if abort_if_cancelled():
                    return job
                details_count += 1
                flush_progress(f"{model.name}: карточка {details_count}/{len(new_links)}…")
                if abort_if_cancelled():
                    return job
                try:
                    parsed = call_with_cancel_poll(
                        lambda u=detail_url: parse_che168_detail(u),
                        should_cancel=abort_if_cancelled,
                    )
                except ParserJobCancelled:
                    return job
                except Exception as e:
                    total_errors += 1
                    total_processed += 1
                    flush_progress(f"Ошибка страницы объявления ({model.name}): {e}")
                    continue

                _ensure_autohome_spec_id(
                    parsed,
                    detail_url,
                    marketplace_from_detail_url(detail_url),
                )
                total_processed += 1

                car = db.execute(
                    select(Car).where(Car.source_listing_id == parsed.source_listing_id)
                ).scalar_one_or_none()

                if car and car.is_active:
                    flush_progress(
                        f"{model.name}: объявление {parsed.source_listing_id} уже в каталоге, пропуск."
                    )
                    continue

                if car and not car.is_active:
                    revived, err = _revive_inactive_car_from_parsed(db, car, model, parsed, download_timeout)
                    if err:
                        total_errors += 1
                        flush_progress(f"Ошибка восстановления ({model.name}): {err}")
                        continue
                    total_updated += 1
                    existing_ids.add(parsed.source_listing_id)
                    flush_progress(
                        f"{model.name}: восстановлено {parsed.source_listing_id}; "
                        f"новых {total_created}, восстановлено {total_updated}."
                    )
                    continue

                _car, err = _insert_car_from_parsed(db, model, parsed, download_timeout)
                if err:
                    total_errors += 1
                    flush_progress(f"Ошибка загрузки фото ({model.name}): {err}")
                    continue

                total_created += 1
                existing_ids.add(parsed.source_listing_id)
                flush_progress(
                    f"{model.name}: обработано {total_processed}, добавлено новых {total_created}."
                )

        job.finished_at = datetime.utcnow()
        job.total_processed = total_processed
        job.total_created = total_created
        job.total_updated = total_updated
        job.total_errors = total_errors

        if total_processed == 0 and total_errors == 0:
            job.status = "success"
            job.message = (
                "Новых объявлений не добавлено: список пуст, все карточки уже в каталоге, "
                "или сайт недоступен/captcha. Проверьте URL каталога в админке и сеть."
            )
        elif total_processed == 0:
            job.status = "failed"
            job.message = (
                "Не удалось разобрать объявления. Проверьте URL, доступность che168 и сообщения выше."
            )
        else:
            job.status = "success"
            job.message = (
                f"Готово: добавлено новых {total_created}, восстановлено {total_updated}, "
                f"попыток разбора {total_processed}, ошибок {total_errors}."
            )
        db.commit()
        db.refresh(job)
        return job

    except Exception as e:
        job.status = "failed"
        job.message = str(e)[:500]
        job.finished_at = datetime.utcnow()
        job.total_processed = total_processed
        job.total_created = total_created
        job.total_updated = total_updated
        job.total_errors = total_errors
        db.commit()
        db.refresh(job)
        return job
    finally:
        if job.finished_at is None:
            job.finished_at = datetime.utcnow()
            job.total_processed = total_processed
            job.total_created = total_created
            job.total_updated = total_updated
            job.total_errors = total_errors
            if job.status == "running":
                job.status = "failed"
                job.message = (job.message or "Прервано без сообщения")[:500]
            elif job.status == "cancelled":
                pass
            db.commit()
            db.refresh(job)
