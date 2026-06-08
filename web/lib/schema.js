import { absoluteUrl } from "./siteUrl";

export function organizationAndWebSiteJsonLd() {
  const url = absoluteUrl("/");
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "avtovozom",
      url,
      description:
        "Сервис подбора и доставки автомобилей из Китая и Кореи в Россию под ключ.",
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "avtovozom",
      url,
      inLanguage: "ru-RU",
    },
  ];
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
  if (data == null) return null;
  const blocks = Array.isArray(data) ? data.filter(Boolean) : [data];
  if (!blocks.length) return null;
  return {
    type: "application/ld+json",
    dangerouslySetInnerHTML: {
      __html: JSON.stringify(blocks.length === 1 ? blocks[0] : blocks),
    },
  };
}
