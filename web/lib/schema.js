import { absoluteUrl } from "./siteUrl";

const SCHEMA_CONTEXT = "https://schema.org";

/** Safari не умеет JSON-LD-массив в script — только объект (@graph). */
function normalizeJsonLd(data) {
  if (data == null) return null;
  if (Array.isArray(data)) {
    const blocks = data.filter(Boolean);
    if (!blocks.length) return null;
    if (blocks.length === 1) return blocks[0];
    return {
      "@context": SCHEMA_CONTEXT,
      "@graph": blocks.map(({ "@context": _ctx, ...node }) => node),
    };
  }
  return data;
}

/**
 * Кириллическое написание бренда — основное. Латиница остаётся в alternateName:
 * без этого поисковик не связывает сайт с запросами вида «автовозом авто из Китая».
 */
export const BRAND_NAME = "Автовозом";
export const BRAND_ALT_NAMES = ["avtovozom", "Avtovozom", "avtovozom.com"];
export const BRAND_EMAIL = "hello@avtovozom.com";
export const BRAND_SAME_AS = ["https://t.me/avtovozom"];

export function organizationAndWebSiteJsonLd() {
  const url = absoluteUrl("/");
  return {
    "@context": SCHEMA_CONTEXT,
    "@graph": [
      {
        "@type": "Organization",
        name: BRAND_NAME,
        alternateName: BRAND_ALT_NAMES,
        url,
        logo: absoluteUrl("/logo-avtovozom.png"),
        image: absoluteUrl("/logo-avtovozom.png"),
        email: BRAND_EMAIL,
        sameAs: BRAND_SAME_AS,
        areaServed: { "@type": "Country", name: "Россия" },
        description:
          "Сервис подбора и доставки автомобилей из Китая и Кореи в Россию под ключ.",
      },
      {
        "@type": "WebSite",
        name: BRAND_NAME,
        alternateName: BRAND_ALT_NAMES,
        url,
        inLanguage: "ru-RU",
        publisher: { "@type": "Organization", name: BRAND_NAME, url },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${url}/?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };
}

/**
 * Список объявлений на странице каталога. Помогает поисковику понять, что хаб —
 * витрина с товарами, а не текстовая страница.
 */
export function itemListJsonLd(items) {
  const list = (items || []).filter((it) => it?.url);
  if (!list.length) return null;
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "ItemList",
    numberOfItems: list.length,
    itemListElement: list.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: absoluteUrl(item.url),
      ...(item.name ? { name: item.name } : {}),
    })),
  };
}

/** @param {{ label: string, href?: string }[]} items */
export function breadcrumbListJsonLd(items) {
  const list = (items || []).filter((it) => it?.label);
  if (!list.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: list.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.label,
      ...(item.href ? { item: absoluteUrl(item.href) } : {}),
    })),
  };
}

export function jsonLdScriptProps(data) {
  const normalized = normalizeJsonLd(data);
  if (normalized == null) return null;
  return {
    type: "application/ld+json",
    dangerouslySetInnerHTML: {
      __html: JSON.stringify(normalized),
    },
  };
}
