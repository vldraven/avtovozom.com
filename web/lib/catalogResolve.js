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

/** Карточек в HTML при SSR (SEO). Клиент догружает полный список. */
export const CATALOG_SSR_LIMIT = 12;

/** Максимум объявлений в ленте каталога на клиенте. */
export const CATALOG_LIST_LIMIT = 100;

export function buildCatalogCarsQuery(resolved, listSort, limit = CATALOG_LIST_LIMIT) {
  const params = new URLSearchParams();
  const { brand, model, generation, badGenSlug, unknownSlug } = resolved;
  if (unknownSlug) return null;
  if (brand) params.set("brand_id", String(brand.id));
  if (model) params.set("model_id", String(model.id));
  if (generation && !badGenSlug) params.set("generation_id", String(generation.id));
  if (listSort && listSort !== "date_desc") params.set("sort", listSort);
  params.set("photo_limit", "8");
  params.set("limit", String(limit));
  return params;
}

export function catalogFetchKey(segments, listSort) {
  const seg = segments.length ? segments.join("/") : "";
  return `${seg}|${listSort || "date_desc"}`;
}
