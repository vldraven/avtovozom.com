const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const PROMO_PLACEMENTS = [
  { key: "home_hero", label: "Главная · hero" },
  { key: "catalog_sidebar", label: "Каталог · сайдбар" },
  { key: "catalog_feed", label: "Каталог · лента (мобайл)" },
  { key: "blog_sidebar", label: "Блог · сайдбар" },
  { key: "blog_feed", label: "Блог · лента (мобайл)" },
];

export function promoCtaHref(campaign) {
  if (!campaign) return "/request-quote";
  if (campaign.cta_href) return campaign.cta_href;
  const path = (campaign.cta_path || "/request-quote").trim() || "/request-quote";
  const code = (campaign.promo_code || "").trim();
  if (!code) return path;
  return `${path}${path.includes("?") ? "&" : "?"}promo=${encodeURIComponent(code)}`;
}

export function placementEnabled(campaign, key) {
  if (!campaign) return false;
  const keys = campaign.placement_keys;
  if (Array.isArray(keys)) return keys.includes(key);
  const rows = campaign.placements || [];
  const row = rows.find((p) => p.placement === key);
  return Boolean(row?.is_enabled);
}

export function getPlacement(campaign, key) {
  if (!campaign) return null;
  return (campaign.placements || []).find((p) => p.placement === key) || null;
}

export function readPromoCodeFromQuery(query) {
  const raw = query?.promo;
  if (typeof raw === "string") return raw.trim().slice(0, 64);
  if (Array.isArray(raw) && raw[0]) return String(raw[0]).trim().slice(0, 64);
  return "";
}

/** Сохраняем код акции из URL, чтобы формы заявок подхватили его. */
export function rememberPromoCode(code) {
  if (typeof window === "undefined") return;
  const value = String(code || "").trim().slice(0, 64);
  try {
    if (value) sessionStorage.setItem("avt_promo_code", value);
  } catch {
    /* ignore */
  }
}

export function getRememberedPromoCode() {
  if (typeof window === "undefined") return "";
  try {
    return (sessionStorage.getItem("avt_promo_code") || "").trim().slice(0, 64);
  } catch {
    return "";
  }
}

function metrikaCounterId() {
  const raw = process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;
  if (raw == null || String(raw).trim() === "") return null;
  const s = String(raw).trim();
  return /^\d+$/.test(s) ? s : null;
}

export function trackPromoClick({ id, placement }) {
  if (typeof window === "undefined") return;
  const counterId = metrikaCounterId();
  if (!counterId || typeof window.ym !== "function") return;
  try {
    window.ym(counterId, "reachGoal", "promo_click", {
      id: id || "",
      placement: placement || "",
    });
  } catch {
    /* ignore */
  }
}

export async function fetchActivePromo(apiBase = API_URL) {
  try {
    const res = await fetch(`${apiBase}/promo/active`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.active || !data.campaign) return null;
    return data.campaign;
  } catch {
    return null;
  }
}

/** Строки title_rest из кампании (переносы → массив). */
export function promoTitleLines(campaign) {
  const rest = (campaign?.title_rest || "").trim();
  if (!rest) return [];
  return rest.split(/\n+/).map((s) => s.trim()).filter(Boolean);
}
