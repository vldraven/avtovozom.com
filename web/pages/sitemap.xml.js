import { publicCarHref } from "../lib/carRoutes";
import { getPublicSiteUrlFromRequest } from "../lib/publicSiteUrl";
import { getServerApiBase } from "../lib/serverApiUrl";
import {
  blogSitemapUrls,
  catalogTreeUrls,
  isoDateOnly,
  renderUrlset,
} from "../lib/sitemapUrls";

const FETCH_MS = 8000;
const CARS_PAGE_MS = 12000;

async function fetchJson(url, timeoutMs = FETCH_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${url}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonRetry(url, timeoutMs = FETCH_MS) {
  try {
    return await fetchJson(url, timeoutMs);
  } catch (err) {
    console.error("sitemap: retry", url, err);
    return fetchJson(url, timeoutMs);
  }
}

function carEntries(base, items) {
  const urls = [];
  for (const car of items || []) {
    const path = publicCarHref(car);
    if (!path) continue;
    const lastmod = isoDateOnly(car.updated_at);
    urls.push({
      loc: `${base}${path}`,
      changefreq: "weekly",
      priority: "0.7",
      ...(lastmod ? { lastmod } : {}),
    });
  }
  return urls;
}

async function fetchCarLocs(api, base) {
  const limit = 100;
  const first = await fetchJson(
    `${api}/cars?page=1&limit=${limit}&sort=date_desc&photo_limit=1`,
    CARS_PAGE_MS
  );
  const total = Number(first.total) || 0;
  const pages = Math.min(500, Math.max(1, Math.ceil(total / limit) || 1));
  const rest = [];
  for (let page = 2; page <= pages; page += 1) {
    rest.push(
      fetchJson(
        `${api}/cars?page=${page}&limit=${limit}&sort=date_desc&photo_limit=1`,
        CARS_PAGE_MS
      )
    );
  }
  const others = rest.length ? await Promise.all(rest) : [];
  return [first, ...others].flatMap((data) => carEntries(base, data.items));
}

export async function getServerSideProps({ req, res }) {
  const base = getPublicSiteUrlFromRequest(req);
  const API_URL = getServerApiBase();

  const staticPaths = [
    "/",
    "/catalog",
    "/customs-calculator",
    "/about",
    "/contacts",
    "/privacy",
    "/terms",
    "/dostavka-avto-iz-kitaya",
    "/dostavka-avtovozom-iz-kitaya",
    "/faq",
    "/blog",
    "/request-quote",
  ];
  const staticUrls = staticPaths.map((loc) => ({
    loc: `${base}${loc}`,
    changefreq: "daily",
    priority: loc === "/" ? "1.0" : loc === "/blog" ? "0.85" : "0.8",
  }));

  const blogPromise = fetchJsonRetry(`${API_URL}/blog/sitemap`).catch((err) => {
    console.error("sitemap: blog unavailable", err);
    return null;
  });
  const treePromise = fetchJson(`${API_URL}/catalog/tree`).catch((err) => {
    console.error("sitemap: catalog tree unavailable", err);
    return null;
  });
  const carsPromise = fetchCarLocs(API_URL, base).catch((err) => {
    console.error("sitemap: cars unavailable", err);
    return [];
  });

  const [blog, tree, carLocs] = await Promise.all([blogPromise, treePromise, carsPromise]);
  const blogUrls = blog ? blogSitemapUrls(base, blog) : [];
  const hubUrls = tree ? catalogTreeUrls(base, tree) : [];

  // Посты сразу после статики: даже усечённый ответ прокси всё ещё содержит блог.
  const all = [...staticUrls, ...blogUrls, ...hubUrls, ...carLocs];
  const body = renderUrlset(all);

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  const publishedPosts = (blog?.posts || []).filter((p) => p?.slug).length;
  if (!blog || publishedPosts === 0) {
    res.setHeader("Cache-Control", "public, max-age=60, must-revalidate");
  } else {
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  }
  res.write(body);
  res.end();

  return { props: {} };
}

export default function SitemapXmlPage() {
  return null;
}
