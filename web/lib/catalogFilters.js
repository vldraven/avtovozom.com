/** Параметры быстрых фильтров каталога (auto.ru-style chips). */

const CURRENT_YEAR = new Date().getFullYear();

export const CATALOG_FILTER_QUERY_KEYS = [
  "year_from",
  "year_to",
  "hp_to",
  "mileage_to",
  "fuel",
  "rub_from",
  "rub_to",
];

/** Query на `/`, которые относятся к листингу — редиректим на `/catalog`. */
export const HOME_LISTING_REDIRECT_QUERY_KEYS = [
  "q",
  "brand",
  "model",
  "sort",
  ...CATALOG_FILTER_QUERY_KEYS,
];

export function homeHasListingQuery(query) {
  if (!query || typeof query !== "object") return false;
  return HOME_LISTING_REDIRECT_QUERY_KEYS.some((key) => {
    const raw = query[key];
    if (raw == null) return false;
    const v = Array.isArray(raw) ? raw[0] : raw;
    return String(v).trim() !== "";
  });
}

export const YEAR_FROM_OPTIONS = Array.from({ length: CURRENT_YEAR - 1999 }, (_, i) => {
  const y = CURRENT_YEAR + 1 - i;
  return { value: String(y), label: `от ${y}` };
});

export const HP_TO_OPTIONS = [
  100, 120, 140, 150, 160, 180, 200, 220, 250, 300, 350, 400,
].map((hp) => ({
  value: String(hp),
  label: `до ${hp.toLocaleString("ru-RU")} л.с.`,
}));

export const MILEAGE_TO_OPTIONS = [
  25_000, 30_000, 35_000, 40_000, 50_000, 60_000, 70_000, 80_000, 100_000, 120_000, 150_000,
].map((km) => ({
  value: String(km),
  label: `до ${km.toLocaleString("ru-RU")} км`,
}));

export const FUEL_TYPE_OPTIONS = [
  { value: "gasoline", label: "Бензин" },
  { value: "hybrid", label: "Гибрид" },
  { value: "electric", label: "Электро" },
];

export const RUB_TO_PRESETS = [
  { value: "1000000", label: "до 1 млн ₽" },
  { value: "1500000", label: "до 1,5 млн ₽" },
  { value: "2000000", label: "до 2 млн ₽" },
  { value: "3000000", label: "до 3 млн ₽" },
  { value: "5000000", label: "до 5 млн ₽" },
];

export const EMPTY_CATALOG_FILTERS = {
  brandId: null,
  modelId: null,
  generationId: null,
  yearFrom: null,
  yearTo: null,
  hpTo: null,
  mileageTo: null,
  fuelType: null,
  rubFrom: null,
  rubTo: null,
};

function firstQueryValue(raw) {
  if (raw == null) return null;
  const v = Array.isArray(raw) ? raw[0] : raw;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function parsePositiveInt(raw) {
  const s = firstQueryValue(raw);
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function parsePositiveFloat(raw) {
  const s = firstQueryValue(raw);
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Разбор query Next.js / URL в объект фильтров. */
export function parseFiltersFromQuery(query, { brandId = null, modelId = null, generationId = null } = {}) {
  const rawB = firstQueryValue(query?.brand);
  const rawM = firstQueryValue(query?.model);
  let bid = brandId;
  let mid = modelId;
  if (rawB) {
    const n = Number(rawB);
    if (!Number.isNaN(n)) bid = n;
  }
  if (rawM) {
    const n = Number(rawM);
    if (!Number.isNaN(n)) mid = n;
  }
  return {
    brandId: bid,
    modelId: mid,
    generationId,
    yearFrom: parsePositiveInt(query?.year_from),
    yearTo: parsePositiveInt(query?.year_to),
    hpTo: parsePositiveInt(query?.hp_to),
    mileageTo: parsePositiveInt(query?.mileage_to),
    fuelType: firstQueryValue(query?.fuel),
    rubFrom: parsePositiveFloat(query?.rub_from),
    rubTo: parsePositiveFloat(query?.rub_to),
  };
}

export function filtersAreEqual(a, b) {
  if (!a || !b) return false;
  return (
    a.brandId === b.brandId &&
    a.modelId === b.modelId &&
    a.generationId === b.generationId &&
    a.yearFrom === b.yearFrom &&
    a.yearTo === b.yearTo &&
    a.hpTo === b.hpTo &&
    a.mileageTo === b.mileageTo &&
    a.fuelType === b.fuelType &&
    a.rubFrom === b.rubFrom &&
    a.rubTo === b.rubTo
  );
}

export function hasActiveCatalogFilters(filters) {
  if (!filters) return false;
  return Boolean(
    filters.yearFrom ||
      filters.yearTo ||
      filters.hpTo ||
      filters.mileageTo ||
      filters.fuelType ||
      filters.rubFrom ||
      filters.rubTo
  );
}

/** Ключ для cache-bust fetch каталога. */
export function catalogFilterKeyFromQuery(query) {
  const f = parseFiltersFromQuery(query);
  const rawQ = firstQueryValue(query?.q);
  return [f.brandId, f.modelId, f.generationId, f.yearFrom, f.yearTo, f.hpTo, f.mileageTo, f.fuelType, f.rubFrom, f.rubTo, rawQ || ""]
    .map((x) => (x == null ? "" : String(x)))
    .join("|");
}

/** Добавить фильтры в URLSearchParams для GET /cars. */
export function appendFiltersToSearchParams(params, filters) {
  if (!params || !filters) return params;
  if (filters.generationId) params.set("generation_id", String(filters.generationId));
  if (filters.yearFrom) params.set("year_from", String(filters.yearFrom));
  if (filters.yearTo) params.set("year_to", String(filters.yearTo));
  if (filters.hpTo) params.set("hp_to", String(filters.hpTo));
  if (filters.mileageTo) params.set("mileage_to", String(filters.mileageTo));
  if (filters.fuelType) params.set("fuel_type", String(filters.fuelType));
  if (filters.rubFrom) params.set("rub_from", String(filters.rubFrom));
  if (filters.rubTo) params.set("rub_to", String(filters.rubTo));
  return params;
}

/** Объект query для router (без brand/model/q/sort). */
export function catalogFiltersToQuery(filters, { omitBrandModel = false } = {}) {
  const out = {};
  if (!omitBrandModel) {
    if (filters.brandId) out.brand = String(filters.brandId);
    if (filters.modelId) out.model = String(filters.modelId);
  }
  if (filters.yearFrom) out.year_from = String(filters.yearFrom);
  if (filters.yearTo) out.year_to = String(filters.yearTo);
  if (filters.hpTo) out.hp_to = String(filters.hpTo);
  if (filters.mileageTo) out.mileage_to = String(filters.mileageTo);
  if (filters.fuelType) out.fuel = String(filters.fuelType);
  if (filters.rubFrom) out.rub_from = String(Math.round(filters.rubFrom));
  if (filters.rubTo) out.rub_to = String(Math.round(filters.rubTo));
  return out;
}

export function fuelTypeLabel(value) {
  return FUEL_TYPE_OPTIONS.find((o) => o.value === value)?.label || value || null;
}

export function formatRubShort(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "";
  if (v >= 1_000_000) {
    const mln = v / 1_000_000;
    return mln % 1 === 0 ? `${mln} млн ₽` : `${mln.toFixed(1).replace(".", ",")} млн ₽`;
  }
  return `${Math.round(v).toLocaleString("ru-RU")} ₽`;
}

export function chipLabelForFilter(key, filters) {
  if (!filters) return null;
  switch (key) {
    case "year":
      if (filters.yearFrom && filters.yearTo) return `${filters.yearFrom}–${filters.yearTo}`;
      if (filters.yearTo) return `до ${filters.yearTo}`;
      return filters.yearFrom ? `от ${filters.yearFrom}` : null;
    case "hp":
      return filters.hpTo ? `до ${Number(filters.hpTo).toLocaleString("ru-RU")} л.с.` : null;
    case "mileage":
      return filters.mileageTo
        ? `до ${Number(filters.mileageTo).toLocaleString("ru-RU")} км`
        : null;
    case "fuelType":
      return fuelTypeLabel(filters.fuelType);
    case "price": {
      if (filters.rubFrom && filters.rubTo) {
        return `${formatRubShort(filters.rubFrom)} – ${formatRubShort(filters.rubTo)}`;
      }
      if (filters.rubTo) return `до ${formatRubShort(filters.rubTo)}`;
      if (filters.rubFrom) return `от ${formatRubShort(filters.rubFrom)}`;
      return null;
    }
    default:
      return null;
  }
}
