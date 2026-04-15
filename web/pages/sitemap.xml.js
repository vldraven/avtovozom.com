import { publicCarHref } from "../lib/carRoutes";
import { getServerApiBase } from "../lib/serverApiUrl";

function getSiteUrlServer() {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/$/, "");
  if (raw) return raw;
  return "http://localhost:3000";
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function getServerSideProps({ res }) {
  const base = getSiteUrlServer();
  const API_URL = getServerApiBase();

  const staticPaths = ["/", "/catalog", "/customs-calculator"];
  const urls = staticPaths.map((loc) => ({
    loc: `${base}${loc}`,
    changefreq: "daily",
    priority: loc === "/" ? "1.0" : "0.8",
  }));

  const limit = 100;
  let page = 1;
  let total = Infinity;
  const carLocs = [];

  try {
    while ((page - 1) * limit < total) {
      const r = await fetch(`${API_URL}/cars?page=${page}&limit=${limit}&sort=date_desc`, {
        headers: { Accept: "application/json" },
      });
      if (!r.ok) break;
      const data = await r.json();
      total = Number(data.total) || 0;
      const items = data.items || [];
      for (const car of items) {
        const path = publicCarHref(car);
        if (path) carLocs.push({ loc: `${base}${path}`, changefreq: "weekly", priority: "0.7" });
      }
      if (items.length < limit) break;
      page += 1;
      if (page > 500) break;
    }
  } catch {
    // только статические URL
  }

  const all = [...urls, ...carLocs];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${all
  .map(
    (u) => `  <url>
    <loc>${escapeXml(u.loc)}</loc>
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
