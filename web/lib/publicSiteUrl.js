/**
 * Публичный origin для getServerSideProps (robots.txt, sitemap.xml).
 * Сначала берём Host из запроса (за прокси — X-Forwarded-Host / X-Forwarded-Proto),
 * иначе NEXT_PUBLIC_SITE_URL. Так в проде не остаётся localhost, если образ собрали без SITE_URL.
 */
function headerFirst(req, name) {
  const v = req?.headers?.[name];
  if (v == null) return "";
  const s = Array.isArray(v) ? v[0] : v;
  return String(s).split(",")[0].trim();
}

function isLocalHost(host) {
  if (!host) return true;
  return (
    /^127\.0\.0\.1(:\d+)?$/i.test(host) ||
    /^localhost(:\d+)?$/i.test(host) ||
    /^0\.0\.0\.0(:\d+)?$/i.test(host) ||
    /^\[::1\](:\d+)?$/i.test(host)
  );
}

export function getPublicSiteUrlFromRequest(req) {
  const host =
    headerFirst(req, "x-forwarded-host") || headerFirst(req, "host") || "";

  if (host && !isLocalHost(host.split(":")[0])) {
    const proto = headerFirst(req, "x-forwarded-proto").toLowerCase();
    const scheme = proto === "http" ? "http" : "https";
    return `${scheme}://${host}`;
  }

  const explicit = (process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/$/, "");
  if (explicit) return explicit;

  if (host) {
    return `http://${host}`;
  }

  return "http://localhost:3000";
}
