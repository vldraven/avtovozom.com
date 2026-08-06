/**
 * Ссылки на соседние разделы каталога. Без них хабы марок и моделей
 * недостижимы кликом и держатся только на sitemap, а такие URL поисковики
 * считают невостребованными.
 *
 * Ссылаемся только на разделы с активными объявлениями: пустые закрыты
 * от индексации, вести на них внутренние ссылки смысла нет.
 */

function withListings(items) {
  return (items || []).filter((x) => x?.slug && Number(x.listings_count) > 0);
}

function byListingsDesc(a, b) {
  return (
    Number(b.listings_count) - Number(a.listings_count) ||
    String(a.name).localeCompare(String(b.name), "ru")
  );
}

function toItems(items, hrefFor) {
  return items.map((x) => ({
    href: hrefFor(x),
    name: x.name,
    count: Number(x.listings_count),
  }));
}

export function catalogHubLinks({ tree, brand, model } = {}) {
  if (brand?.slug) {
    const models = withListings(brand.models).sort(byListingsDesc);

    if (model?.slug) {
      const others = models.filter((m) => m.slug !== model.slug);
      if (!others.length) return null;
      return {
        title: `Другие модели ${brand.name}`,
        items: toItems(others, (m) => `/catalog/${brand.slug}/${m.slug}`),
      };
    }

    if (!models.length) return null;
    return {
      title: `Модели ${brand.name}`,
      items: toItems(models, (m) => `/catalog/${brand.slug}/${m.slug}`),
    };
  }

  const brands = withListings(tree).sort(byListingsDesc);
  if (!brands.length) return null;
  return {
    title: "Марки",
    items: toItems(brands, (b) => `/catalog/${b.slug}`),
  };
}
