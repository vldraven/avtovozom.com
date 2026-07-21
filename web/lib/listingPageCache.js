/**
 * In-memory кэш лент (главная / каталог / избранное) для бесшовного «назад» из карточки.
 * Без TTL: данные живут, пока открыта вкладка; явный сброс — clearListingPageCache.
 */

const store = new Map();

function cacheKey(namespace, key) {
  return `${namespace}::${key || ""}`;
}

export function setListingPageCache(namespace, key, payload) {
  if (typeof window === "undefined" || !namespace || key == null || !payload) return;
  const prev = store.get(cacheKey(namespace, key)) || {};
  store.set(cacheKey(namespace, key), {
    ...prev,
    ...payload,
    savedAt: Date.now(),
  });
}

export function getListingPageCache(namespace, key) {
  if (typeof window === "undefined" || !namespace || key == null) return null;
  return store.get(cacheKey(namespace, key)) || null;
}

export function clearListingPageCache(namespace, key = null) {
  if (typeof window === "undefined" || !namespace) return;
  if (key != null) {
    store.delete(cacheKey(namespace, key));
    return;
  }
  const prefix = `${namespace}::`;
  for (const k of store.keys()) {
    if (String(k).startsWith(prefix)) store.delete(k);
  }
}
