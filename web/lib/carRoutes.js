/** Публичный URL карточки объявления (канонический путь с ЧПУ). */

export function publicCarHref(car) {
  if (
    car &&
    typeof car.brand_slug === "string" &&
    car.brand_slug &&
    typeof car.model_slug === "string" &&
    car.model_slug &&
    car.id != null
  ) {
    return `/catalog/${car.brand_slug}/${car.model_slug}/${car.id}`;
  }
  if (car != null && car.id != null) return `/cars/${car.id}`;
  return "/catalog";
}
