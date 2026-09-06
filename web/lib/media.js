const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** Ширины, которые принимает backend /media-img (белый список). */
export const MEDIA_WIDTH = {
  thumb: 160,
  cardSm: 320,
  cardMd: 480,
  card: 640,
  detail: 960,
};

/** Сколько фото URL отдавать в списках (скраб подгружает остальные по hover). */
export const LIST_PHOTO_LIMIT = 4;

/** srcset для карточек каталога/главной (как набор размеров на auto.ru). */
export const CARD_SRCSET_WIDTHS = [320, 480, 640];

/** srcset для hero карточки авто. */
export const DETAIL_SRCSET_WIDTHS = [480, 640, 960];

export const CARD_SIZES = "(max-width: 767px) 100vw, (max-width: 1200px) 50vw, 33vw";
export const DETAIL_SIZES = "(max-width: 767px) 100vw, 900px";

export function getApiBase() {
  return API_URL.replace(/\/$/, "");
}

/**
 * URL для <img>: локальные /media/… или прокси для внешних CDN.
 * @param {string} u storage_url из API
 * @param {number} [width] если задан и путь локальный — /media-img?path=…&w=…
 */
export function mediaSrc(u, width) {
  if (!u) return "";
  const base = getApiBase();
  if (u.startsWith("http://") || u.startsWith("https://")) {
    return `${base}/media-proxy?url=${encodeURIComponent(u)}`;
  }
  const path = u.startsWith("/") ? u : `/${u}`;
  if (width && path.startsWith("/media/")) {
    const w = Number(width);
    if (Number.isFinite(w) && w > 0) {
      return `${base}/media-img?path=${encodeURIComponent(path)}&w=${Math.round(w)}`;
    }
  }
  return `${base}${path}`;
}

/**
 * Строка srcset для локальных /media/… (внешние CDN через proxy — без вариантов).
 * @param {string} u storage_url
 * @param {number[]} widths
 */
export function mediaSrcSet(u, widths) {
  if (!u || !widths?.length) return undefined;
  if (u.startsWith("http://") || u.startsWith("https://")) return undefined;
  const path = u.startsWith("/") ? u : `/${u}`;
  if (!path.startsWith("/media/")) return undefined;
  const parts = [];
  for (const w of widths) {
    const n = Number(w);
    if (!Number.isFinite(n) || n <= 0) continue;
    const src = mediaSrc(u, n);
    if (src) parts.push(`${src} ${Math.round(n)}w`);
  }
  return parts.length ? parts.join(", ") : undefined;
}
