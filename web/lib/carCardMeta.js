/** Объём ДВС для карточек: см³ → «1 500 см³» (как на проде — не путается с л.с.). */
export function formatEngineVolumeCc(cc) {
  if (cc == null) return null;
  const n = Number(cc);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${Math.round(n).toLocaleString("ru-RU")} см³`;
}

/** @deprecated используйте formatEngineVolumeCc */
export function formatEngineVolumeLiters(cc) {
  if (cc == null) return null;
  const n = Number(cc);
  if (!Number.isFinite(n) || n <= 0) return null;
  const liters = n / 1000;
  const label =
    liters >= 10
      ? String(Math.round(liters))
      : liters
          .toFixed(1)
          .replace(/\.0$/, "")
          .replace(".", ",");
  return `${label} л`;
}

export function resolveHorsepower(car) {
  if (!car) return null;
  const n = Number(car.horsepower);
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  const blob = [car.title, car.description].filter(Boolean).join(" ");
  if (!blob) return null;
  const m = blob.match(/(\d{2,3})\s*(?:л\.?\s*с\.?|лс\b|hp\b|PS\b)/i);
  if (!m) return null;
  const hp = Number(m[1]);
  return Number.isFinite(hp) && hp > 0 ? hp : null;
}

export function carTotalRub(car) {
  if (!car) return null;
  if (car.price_breakdown?.total_rub != null) return car.price_breakdown.total_rub;
  if (car.estimated_total_rub != null) return car.estimated_total_rub;
  return null;
}

export function carListingTitle(car) {
  if (car?.brand && car?.model) {
    return `${car.brand} ${car.model}${car.year ? `, ${car.year}` : ""}`;
  }
  return car?.title || "";
}

/**
 * Спеки для meta-строки карточки: год, объём, л.с., топливо[, пробег].
 * Мощность всегда сразу после объёма — важный параметр, не должен «теряться» в конце.
 */
export function carSpecMetaBits(car, { includeMileage = true } = {}) {
  if (!car) return [];
  const bits = [];
  if (car.year) bits.push(String(car.year));
  const volume = formatEngineVolumeCc(car.engine_volume_cc);
  if (volume) bits.push(volume);
  const hp = resolveHorsepower(car);
  if (hp != null) bits.push(`${hp.toLocaleString("ru-RU")} л.с.`);
  if (car.fuel_type) bits.push(String(car.fuel_type));
  if (includeMileage && car.mileage_km != null) {
    bits.push(`${Number(car.mileage_km).toLocaleString("ru-RU")} км`);
  }
  return bits;
}
