import { getPublicSiteUrlFromRequest } from "../lib/publicSiteUrl";

export async function getServerSideProps({ req, res }) {
  const base = getPublicSiteUrlFromRequest(req);

  const disallow = [
    "/auth",
    "/profile",
    "/messages",
    "/favorites",
    "/reset-password",
    "/staff/",
  ]
    .map((path) => `Disallow: ${path}`)
    .join("\n");

  /**
   * Параметры фильтров каталога не меняют состав страницы для поисковика:
   * canonical у всех вариантов один и тот же. Clean-param убирает их из обхода,
   * иначе Яндекс тратит краулинговый бюджет на сотни копий /catalog.
   */
  const filterParams = [
    "brand",
    "model",
    "year_from",
    "year_to",
    "hp_to",
    "mileage_to",
    "fuel",
    "rub_from",
    "rub_to",
    "sort",
    "q",
  ].join("&");

  // У Яндекса свой блок: он читает только его и игнорирует User-agent: *.
  const body = `User-agent: *
Allow: /

# Личные кабинеты и служебные разделы
${disallow}

User-agent: Yandex
Allow: /

# Личные кабинеты и служебные разделы
${disallow}

Clean-param: ${filterParams} /catalog

Sitemap: ${base}/sitemap.xml
`;

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=86400");
  res.write(body);
  res.end();

  return { props: {} };
}

/** Пустой UI: ответ уже отправлен в getServerSideProps */
export default function RobotsTxtPage() {
  return null;
}
