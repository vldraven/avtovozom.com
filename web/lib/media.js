const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function getApiBase() {
  return API_URL.replace(/\/$/, "");
}

/** URL для <img>: локальные /media/… или прокси для внешних CDN */
export function mediaSrc(u) {
  if (!u) return "";
  const base = getApiBase();
  if (u.startsWith("http://") || u.startsWith("https://")) {
    return `${base}/media-proxy?url=${encodeURIComponent(u)}`;
  }
  return `${base}${u.startsWith("/") ? u : `/${u}`}`;
}
