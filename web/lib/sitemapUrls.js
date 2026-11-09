/** Сборка URL для sitemap.xml — без fetch, чтобы можно было покрыть тестом. */

export function isoDateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function hasListings(node) {
  return Number(node?.listings_count) > 0;
}

/**
 * Только хабы с активными объявлениями. Справочник марок и моделей намного
 * шире того, что реально продаётся, и пустые разделы в sitemap Яндекс
 * трактует как малоценные страницы — вместе с деградацией оценки хоста.
 */
export function catalogTreeUrls(base, tree) {
  const urls = [];
  for (const brand of tree || []) {
    if (!brand?.slug || !hasListings(brand)) continue;
    urls.push({
      loc: `${base}/catalog/${brand.slug}`,
      changefreq: "daily",
      priority: "0.85",
    });
    for (const model of brand.models || []) {
      if (!model?.slug || !hasListings(model)) continue;
      urls.push({
        loc: `${base}/catalog/${brand.slug}/${model.slug}`,
        changefreq: "daily",
        priority: "0.8",
      });
    }
  }
  return urls;
}

/**
 * Посты — канонические /blog/{slug}. Рубрики с ?section= не кладём:
 * это фильтр той же ленты, поисковики такие loc часто отбрасывают.
 */
export function blogSitemapUrls(base, blog) {
  const urls = [];
  for (const post of blog?.posts || []) {
    const slug = String(post?.slug || "").replace(/^\/+|\/+$/g, "");
    if (!slug) continue;
    const lastmod = isoDateOnly(post.updated_at);
    urls.push({
      loc: `${base}/blog/${slug}`,
      changefreq: "weekly",
      priority: "0.75",
      ...(lastmod ? { lastmod } : {}),
    });
  }
  urls.push({ loc: `${base}/blog/sections`, changefreq: "weekly", priority: "0.6" });
  for (const author of blog?.authors || []) {
    const slug = String(author || "").replace(/^\/+|\/+$/g, "");
    if (!slug) continue;
    urls.push({
      loc: `${base}/blog/authors/${slug}`,
      changefreq: "weekly",
      priority: "0.5",
    });
  }
  return urls;
}

export function renderUrlset(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${(entries || [])
  .map(
    (u) => `  <url>
    <loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ""}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;
}
