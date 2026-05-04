from collections.abc import Callable
from datetime import datetime
import os

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, joinedload

from .che168_parser import (
    ParsedCar,
    car_source_for_marketplace,
    filter_vehicle_photo_urls,
    marketplace_from_detail_url,
    normalize_import_detail_url,
    parse_che168_detail,
    parse_che168_listing_links,
    source_listing_id_from_url,
)
from .listing_copy_ru import basic_neutral_description_ru, pick_title_ru
from .body_colors import label_for_slug
from .media_storage import delete_car_photo_files, download_car_photos
from .models import Car, CarPhoto, CarModel, ModelWhitelist, ParseJob
from .model_resolver import resolve_model_id_for_listing
from .parser_timeout import call_with_timeout
from .translator_ru import translate_to_ru


def _insert_car_from_parsed(
    db: Session,
    model: CarModel,
    parsed: ParsedCar,
    download_timeout: float,
    progress_cb: Callable[[str], None] | None = None,
    car_source: str = "che168",
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

    title_tr = translate_to_ru(parsed.title) or parsed.title
    title_ru = pick_title_ru(
        model.brand.name,
        display_model_name,
        parsed.year or 2020,
        parsed.title,
        title_tr,
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
        title=title_ru,
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
    return car, None


def _revive_inactive_car_from_parsed(
    db: Session,
    car: Car,
    model: CarModel,
    parsed: ParsedCar,
    download_timeout: float,
    progress_cb: Callable[[str], None] | None = None,
    car_source: str = "che168",
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

    title_tr = translate_to_ru(parsed.title) or parsed.title
    title_ru = pick_title_ru(
        model.brand.name,
        display_model_name,
        parsed.year or 2020,
        parsed.title,
        title_tr,
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
    car.title = title_ru
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

    demo_rows = (
        db.execute(select(Car).where(Car.source_listing_id.like("demo-%"))).scalars().all()
    )
    for row in demo_rows:
        row.is_active = False
    db.commit()

    mid = job.import_model_id
    raw_url = (job.import_detail_url or "").strip()
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
            "Нужна прямая ссылка: che168 — …/dealer/…/….html или i.che168.com/car/…; "
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
            total_processed = 1
            job.finished_at = datetime.utcnow()
            job.total_processed = total_processed
            job.total_created = 0
            job.total_updated = total_updated
            job.total_errors = total_errors
            job.status = "success"
            job.message = "Это объявление уже есть в каталоге."
            db.commit()
            db.refresh(job)
            return job

        flush_progress("1/3 Загрузка страницы объявления…")
        try:
            parsed = call_with_timeout(lambda: parse_che168_detail(detail_url))
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

        total_processed = 1
        flush_progress("2/3 Сохранение объявления в каталог…")

        car = db.execute(
            select(Car).where(Car.source_listing_id == parsed.source_listing_id)
        ).scalar_one_or_none()
        if car and car.is_active:
            job.finished_at = datetime.utcnow()
            job.total_processed = total_processed
            job.total_created = 0
            job.total_updated = total_updated
            job.total_errors = total_errors
            job.status = "success"
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
            job.message = (
                f"Объявление восстановлено #{car_new.id}: {model.brand.name} {model.name}."
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
        job.message = (
            f"Добавлено объявление #{car_new.id}: {model.brand.name} {model.name}."
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
            db.commit()
            db.refresh(job)


def run_parser_job(db: Session, job: ParseJob) -> ParseJob:
    if job.import_model_id is not None and (job.import_detail_url or "").strip():
        return _run_single_listing_import(db, job)

    job.status = "running"
    job.started_at = datetime.utcnow()
    db.commit()
    db.refresh(job)

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
            model: CarModel = wl.model
            if not model.che168_url and not force_urls:
                continue

            job.status = "running"
            flush_progress(f"{model.name}: открываю список на che168…")

            links = []
            try:
                series_placeholder = model.che168_url or "https://www.che168.com/"
                links = parse_che168_listing_links(series_placeholder, max_items=max_links)
            except Exception as e:
                total_errors += 1
                flush_progress(f"Ошибка ссылок для {model.name}: {e}")
                continue

            if not links:
                flush_progress(
                    f"{model.name}: ссылок на объявления не найдено (пустой список или недоступен сайт)."
                )
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
                continue

            flush_progress(
                f"{model.name}: к разбору {len(new_links)} новых объявлений (макс. {max_new} за запуск)."
            )

            details_count = 0
            for detail_url in new_links:
                details_count += 1
                flush_progress(f"{model.name}: карточка {details_count}/{len(new_links)}…")
                try:
                    parsed = call_with_timeout(lambda u=detail_url: parse_che168_detail(u))
                except Exception as e:
                    total_errors += 1
                    total_processed += 1
                    flush_progress(f"Ошибка страницы объявления ({model.name}): {e}")
                    continue

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
            db.commit()
            db.refresh(job)
