/**
 * Короткий in-memory кэш публичных /catalog/brands и /catalog/tree.
 * Только публичная навигация; staff/admin API сюда не ходит.
 * TTL совпадает с Cache-Control на backend (120s).
 */

const TTL_MS = 120_000;

/** @type {Map<string, { savedAt: number, data: unknown }>} */
const store = new Map();

function isFresh(entry) {
  return Boolean(entry) && Date.now() - entry.savedAt < TTL_MS;
}

export function getCatalogMetaCache(key) {
  if (typeof window === "undefined" || !key) return null;
  const entry = store.get(String(key));
  if (!isFresh(entry)) {
    if (entry) store.delete(String(key));
    return null;
  }
  return entry.data;
}

export function setCatalogMetaCache(key, data) {
  if (typeof window === "undefined" || !key || data == null) return;
  store.set(String(key), { savedAt: Date.now(), data });
}

export function clearCatalogMetaCache(key = null) {
  if (typeof window === "undefined") return;
  if (key != null) {
    store.delete(String(key));
    return;
  }
  store.clear();
}

export async function fetchCatalogBrandsCached(apiUrl) {
  const cached = getCatalogMetaCache("brands");
  if (cached) return cached;
  const res = await fetch(`${apiUrl}/catalog/brands`);
  if (!res.ok) throw new Error(`brands ${res.status}`);
  const data = await res.json();
  setCatalogMetaCache("brands", data);
  return data;
}

export async function fetchCatalogTreeCached(apiUrl) {
  const cached = getCatalogMetaCache("tree");
  if (Array.isArray(cached) && cached.length > 0) return cached;
  const res = await fetch(`${apiUrl}/catalog/tree`);
  if (!res.ok) throw new Error(`tree ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data) && data.length > 0) {
    setCatalogMetaCache("tree", data);
  }
  return data;
}
