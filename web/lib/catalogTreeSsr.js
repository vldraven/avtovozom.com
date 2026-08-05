/**
 * Урезанный справочник каталога для SSR-пейлоада.
 *
 * Полное дерево — 97 марок, 1264 модели и 316 поколений, около 177 КБ, и оно
 * попадает в __NEXT_DATA__ каждой страницы каталога и главной. Это две трети
 * веса HTML при том, что сами объявления занимают вшестеро меньше.
 *
 * Разметке на сервере нужны только разделы с объявлениями (перелинковка хабов,
 * счётчики) плюс те, что открыты в адресе — иначе пустой хаб вроде
 * /catalog/jaguar перестанет разрешаться и уйдёт в 404 или редирект. Полное
 * дерево для фильтров догружает клиент после гидратации.
 */

function hasListings(node) {
  return Number(node?.listings_count) > 0;
}

export function trimCatalogTreeForSsr(tree, segments = []) {
  const [brandSlug, modelSlug, generationSlug] = segments || [];
  const out = [];

  for (const brand of tree || []) {
    const brandOnPath = Boolean(brand?.slug) && brand.slug === brandSlug;
    if (!hasListings(brand) && !brandOnPath) continue;

    const models = [];
    for (const model of brand.models || []) {
      const modelOnPath = brandOnPath && model?.slug === modelSlug;
      if (!hasListings(model) && !modelOnPath) continue;

      const generations = (model.generations || []).filter(
        (gen) => hasListings(gen) || (modelOnPath && gen?.slug === generationSlug)
      );
      models.push({ ...model, generations });
    }

    out.push({ ...brand, models });
  }

  return out;
}
