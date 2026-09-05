/**
 * In-memory кэш превью (blob URL), чтобы при «назад» из карточки
 * фото в каталоге/на главной не дергали сеть и не мигали.
 * LRU + лимит по числу и суммарному размеру.
 */

const MAX_ENTRIES = 120;
const MAX_BYTES = 48 * 1024 * 1024;

/** @type {Map<string, { objectUrl: string, bytes: number, lastUsed: number }>} */
const entries = new Map();

/** @type {Map<string, Promise<string>>} */
const inflight = new Map();

function touch(src, entry) {
  entry.lastUsed = Date.now();
  entries.delete(src);
  entries.set(src, entry);
}

function prune() {
  let total = 0;
  for (const e of entries.values()) total += e.bytes || 0;
  while (entries.size > MAX_ENTRIES || total > MAX_BYTES) {
    const oldestKey = entries.keys().next().value;
    if (oldestKey == null) break;
    const e = entries.get(oldestKey);
    entries.delete(oldestKey);
    if (e?.objectUrl) {
      try {
        URL.revokeObjectURL(e.objectUrl);
      } catch {
        /* ignore */
      }
      total -= e.bytes || 0;
    }
  }
}

/** Синхронно: blob URL если уже в памяти, иначе null. */
export function peekMediaImageCache(src) {
  if (!src || typeof window === "undefined") return null;
  const entry = entries.get(src);
  if (!entry) return null;
  touch(src, entry);
  return entry.objectUrl;
}

export function rememberMediaImageBlob(src, blob) {
  if (!src || !blob || typeof window === "undefined") return null;
  const existing = entries.get(src);
  if (existing) {
    touch(src, existing);
    return existing.objectUrl;
  }
  const objectUrl = URL.createObjectURL(blob);
  entries.set(src, {
    objectUrl,
    bytes: Number(blob.size) || 0,
    lastUsed: Date.now(),
  });
  prune();
  return objectUrl;
}

/**
 * Гарантирует запись в кэше. Возвращает blob URL или исходный src при ошибке.
 * Повторные вызовы с тем же src дедуплицируются.
 */
export function ensureMediaImageCached(src) {
  if (!src || typeof window === "undefined") return Promise.resolve(src);
  const hit = peekMediaImageCache(src);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(src);
  if (pending) return pending;

  const task = (async () => {
    try {
      const res = await fetch(src, {
        mode: "cors",
        credentials: "omit",
        cache: "force-cache",
      });
      if (!res.ok) return src;
      const blob = await res.blob();
      if (!blob || (blob.type && !blob.type.startsWith("image/"))) return src;
      return rememberMediaImageBlob(src, blob) || src;
    } catch {
      return src;
    } finally {
      inflight.delete(src);
    }
  })();

  inflight.set(src, task);
  return task;
}

/** Прогрев списка URL (карточки каталога / скраб). */
export function warmMediaImageSources(sources) {
  if (typeof window === "undefined" || !sources?.length) return;
  for (const src of sources) {
    if (src) ensureMediaImageCached(src);
  }
}
