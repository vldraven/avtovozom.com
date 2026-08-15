const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** Ширины, которые принимает backend /media-img (белый список). */
export const MEDIA_WIDTH = {
  thumb: 160,
  card: 640,
  detail: 960,
};

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
