import { appendFiltersToSearchParams } from "./catalogFilters";

export function segmentsFromSlugParam(slug) {
  if (slug == null) return [];
  if (Array.isArray(slug)) return slug.map(String).filter(Boolean);
  return [String(slug)].filter(Boolean);
}

export function isCarDetailSegments(segments) {
  return segments != null && segments.length === 3 && /^\d+$/.test(String(segments[2]));
}

/** Разбор slug каталога по дереву марок (как на клиенте). */
export function resolveCatalogTree(segments, tree) {
  if (!Array.isArray(tree) || !tree.length) {
    return {
      brand: null,
      model: null,
      generation: null,
      unknownSlug: false,
      badModelSlug: false,
      badGenSlug: false,
    };
  }
  const [bSlug, mSlug, gSlug] = segments;
  if (!bSlug) {
    return {
      brand: null,
      model: null,
      generation: null,
      unknownSlug: false,
      badModelSlug: false,
      badGenSlug: false,
    };
  }
  const b = tree.find((x) => x.slug === bSlug);
  if (!b) {
    return {
      brand: null,
      model: null,
      generation: null,
      unknownSlug: true,
      badModelSlug: false,
      badGenSlug: false,
    };
  }
  if (!mSlug) {
    return {
      brand: b,
      model: null,
      generation: null,
      unknownSlug: false,
      badModelSlug: false,
      badGenSlug: false,
    };
  }
  const m = b.models.find((x) => x.slug === mSlug);
  if (!m) {
    return {
      brand: b,
      model: null,
      generation: null,
      unknownSlug: false,
      badModelSlug: true,
      badGenSlug: false,
    };
  }
  if (!gSlug) {
    return {
      brand: b,
      model: m,
      generation: null,
      unknownSlug: false,
      badModelSlug: false,
      badGenSlug: false,
    };
  }
  const gen = (m.generations || []).find((x) => x.slug === gSlug);
  if (!gen) {
    return {
      brand: b,
      model: m,
      generation: null,
      unknownSlug: false,
      badModelSlug: false,
      badGenSlug: true,
    };
  }
  return {
    brand: b,
    model: m,
    generation: gen,
    unknownSlug: false,
    badModelSlug: false,
    badGenSlug: false,
  };
}

/**
 * Хаб каталога без активных объявлений. Такая страница остаётся доступной
 * пользователю, но закрывается от индексации: пустые разделы Яндекс помечает
 * как малоценные и снижает оценку хоста целиком.
 *
 * Если дерево не загрузилось или счётчика нет, считаем хаб непустым — иначе
 * при сбое API из индекса выпадут живые разделы.
 */
export function isEmptyCatalogHub({ brand, model, generation } = {}) {
  const target = generation || model || brand;
  if (!target) return false;
  const count = Number(target.listings_count);
  return Number.isFinite(count) && count === 0;
}

/** Размер страницы ленты каталога (SSR и клиент одинаковые — корректный page=N). */
export const CATALOG_PAGE_SIZE = 24;

/** @deprecated используйте CATALOG_PAGE_SIZE; оставлено для совместимости импортов. */
export const CATALOG_SSR_LIMIT = CATALOG_PAGE_SIZE;

/** @deprecated жёсткий «всё сразу» больше не используется — пагинация через page. */
export const CATALOG_LIST_LIMIT = 100;

/** Сколько объявлений отдавать в HTML при SSR (первая страница). */
export function catalogSsrCarsLimit(_resolved) {
  return CATALOG_PAGE_SIZE;
}

export function buildCatalogCarsQuery(
  resolved,
  listSort,
  limit = CATALOG_PAGE_SIZE,
  filterQuery = null,
  textQuery = null,
  page = 1
) {
  const params = new URLSearchParams();
  const { brand, model, generation, badGenSlug, unknownSlug } = resolved;
  if (unknownSlug) return null;
  if (brand) params.set("brand_id", String(brand.id));
  if (model) params.set("model_id", String(model.id));
  if (generation && !badGenSlug) params.set("generation_id", String(generation.id));
  if (listSort && listSort !== "relevance") params.set("sort", listSort);
  if (filterQuery) {
    appendFiltersToSearchParams(params, filterQuery);
    // Query brand/model на /catalog без slug (редирект с главной, ссылки без slug).
    if (!brand && filterQuery.brandId) params.set("brand_id", String(filterQuery.brandId));
    if (!model && filterQuery.modelId) params.set("model_id", String(filterQuery.modelId));
  }
  const qq = textQuery != null ? String(textQuery).trim() : "";
  if (qq) params.set("q", qq);
  params.set("photo_limit", "8");
  params.set("limit", String(limit));
  const pageNum = Math.max(1, Number(page) || 1);
  if (pageNum > 1) params.set("page", String(pageNum));
  return params;
}

export function catalogTextQueryFromRouter(query) {
  if (!query) return "";
  const raw = query.q;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v != null ? String(v).trim() : "";
}

export function catalogFetchKey(segments, listSort, filterKey = "", textQuery = "") {
  const seg = segments.length ? segments.join("/") : "";
  return `${seg}|${listSort || "relevance"}|${filterKey || ""}|${textQuery || ""}`;
}
