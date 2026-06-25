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

export function organizationAndWebSiteJsonLd() {
  const url = absoluteUrl("/");
  const logo = absoluteUrl("/favicon.png");
  return {
    "@context": SCHEMA_CONTEXT,
    "@graph": [
      {
        "@type": "Organization",
        name: "avtovozom",
        url,
        logo,
        description:
          "Сервис подбора и доставки автомобилей из Китая и Кореи в Россию под ключ.",
      },
      {
        "@type": "WebSite",
        name: "avtovozom",
        url,
        inLanguage: "ru-RU",
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
