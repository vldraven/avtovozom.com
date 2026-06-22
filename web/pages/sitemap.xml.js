import { publicCarHref } from "../lib/carRoutes";
import { getPublicSiteUrlFromRequest } from "../lib/publicSiteUrl";
import { getServerApiBase } from "../lib/serverApiUrl";

/** YYYY-MM-DD для <lastmod> (W3C Datetime). Возвращает null, если дата некорректна. */
function isoDateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function catalogTreeUrls(base, tree) {
  const urls = [];
  for (const brand of tree || []) {
    if (!brand?.slug) continue;
    urls.push({
      loc: `${base}/catalog/${brand.slug}`,
      changefreq: "daily",
      priority: "0.85",
    });
    for (const model of brand.models || []) {
      if (!model?.slug) continue;
      urls.push({
        loc: `${base}/catalog/${brand.slug}/${model.slug}`,
        changefreq: "daily",
        priority: "0.8",
      });
    }
  }
  return urls;
}

export async function getServerSideProps({ req, res }) {
  const base = getPublicSiteUrlFromRequest(req);
  const API_URL = getServerApiBase();

  const staticPaths = [
    "/",
    "/catalog",
    "/customs-calculator",
    "/dostavka-avto-iz-kitaya",
    "/dostavka-avto-iz-korei",
    "/faq",
  ];
  const urls = staticPaths.map((loc) => ({
    loc: `${base}${loc}`,
    changefreq: "daily",
    priority: loc === "/" ? "1.0" : "0.8",
  }));

  try {
    const treeRes = await fetch(`${API_URL}/catalog/tree`, {
      headers: { Accept: "application/json" },
    });
    if (treeRes.ok) {
      const tree = await treeRes.json();
      urls.push(...catalogTreeUrls(base, tree));
    }
  } catch {
    /* только статические URL */
  }

  const limit = 100;
  let page = 1;
  let total = Infinity;
  const carLocs = [];

  try {
    while ((page - 1) * limit < total) {
      const r = await fetch(
        `${API_URL}/cars?page=${page}&limit=${limit}&sort=date_desc&photo_limit=1`,
        {
          headers: { Accept: "application/json" },
        }
      );
      if (!r.ok) break;
      const data = await r.json();
      total = Number(data.total) || 0;
      const items = data.items || [];
      for (const car of items) {
        const path = publicCarHref(car);
        if (path) {
          const lastmod = isoDateOnly(car.updated_at);
          carLocs.push({
            loc: `${base}${path}`,
            changefreq: "weekly",
            priority: "0.7",
            ...(lastmod ? { lastmod } : {}),
          });
        }
      }
      if (items.length < limit) break;
      page += 1;
      if (page > 500) break;
    }
  } catch {
    /* только статические URL */
  }

  const all = [...urls, ...carLocs];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${all
  .map(
    (u) => `  <url>
    <loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ""}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.write(body);
  res.end();

  return { props: {} };
}

export default function SitemapXmlPage() {
  return null;
}
