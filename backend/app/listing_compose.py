"""Общие данные для публикации объявления (Telegram, Avito)."""

from __future__ import annotations

from dataclasses import dataclass

from .catalog_slug import slugs_for_car
from .models import Car


@dataclass
class ListingMarketingCompose:
    car_id: int
    title: str
    brand: str
    model: str
    generation: str | None
    year: int
    mileage_km: int | None
    engine_volume_cc: int
    horsepower: int
    fuel_type: str | None
    transmission: str | None
    location_city: str | None
    price_cny: float
    description: str
    rub_china: float | None
    estimated_total_rub: float | None
    canonical_path: str
    canonical_web_url: str
    photos: list[tuple[int, str, int, str]]
    """id, storage_url, sort_order, absolute_url"""


def build_listing_marketing_compose(
    car: Car,
    *,
    public_web_origin: str,
    slug_maps: tuple[dict[int, str], dict[int, str]],
    absolute_url_fn,
    rub_china: float | None,
    estimated_total_rub: float | None,
) -> ListingMarketingCompose:
    brand_slug, model_slug = slugs_for_car(car, slug_maps[0], slug_maps[1])
    if brand_slug and model_slug:
        path = f"/catalog/{brand_slug}/{model_slug}/{car.id}"
    else:
        path = f"/cars/{car.id}"
    listing_url = f"{public_web_origin.rstrip('/')}{path}"

    photos_sorted = sorted(car.photos or [], key=lambda p: (p.sort_order, p.id))
    photos_out = [
        (
            p.id,
            p.storage_url,
            p.sort_order,
            absolute_url_fn(p.storage_url),
        )
        for p in photos_sorted
    ]
    gen = getattr(car, "generation", None)

    return ListingMarketingCompose(
        car_id=car.id,
        title=car.title,
        brand=car.brand.name,
        model=car.model.name,
        generation=(gen.name if gen is not None else None),
        year=car.year,
        mileage_km=car.mileage_km,
        engine_volume_cc=car.engine_volume_cc,
        horsepower=car.horsepower,
        fuel_type=car.fuel_type,
        transmission=car.transmission,
        location_city=car.location_city,
        price_cny=float(car.price_cny),
        description=(car.description or "").strip(),
        rub_china=rub_china,
        estimated_total_rub=estimated_total_rub,
        canonical_path=path,
        canonical_web_url=listing_url,
        photos=photos_out,
    )
