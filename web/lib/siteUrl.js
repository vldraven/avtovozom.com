/**
 * Канонический origin сайта для SEO (og:url, sitemap, JSON-LD).
 * В проде задайте NEXT_PUBLIC_SITE_URL=https://avtovozom.com (без слэша в конце).
 */
export function getSiteUrl() {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/$/, "");
  if (raw) return raw;
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "http://localhost:3000";
}

/** Абсолютный URL пути вида /catalog/... */
export function absoluteUrl(path) {
  const base = getSiteUrl();
  if (!path || path === "/") return base;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
