import {
  clearScrollRestoreTarget,
  pathsMatchForScrollRestore,
  peekScrollRestoreTarget,
} from "./listingNavigation";

/**
 * Восстановление позиции скролла списка объявлений после возврата из карточки.
 * Возвращает функцию очистки таймеров / rAF.
 */
export function scheduleListScrollRestore({ storagePrefix, path, cardDataAttr }) {
  if (typeof window === "undefined" || !path) return () => {};

  const restoreTarget = peekScrollRestoreTarget();
  if (!restoreTarget || !pathsMatchForScrollRestore(restoreTarget, path)) {
    return () => {};
  }

  // Ключ мог быть записан с полным asPath (с query) — читаем оба варианта.
  const keys = Array.from(new Set([`${storagePrefix}${path}`, `${storagePrefix}${restoreTarget}`]));
  let storageKey = null;
  let raw = null;
  for (const key of keys) {
    const value = sessionStorage.getItem(key);
    if (value) {
      storageKey = key;
      raw = value;
      break;
    }
  }

  if (!storageKey || !raw) {
    clearScrollRestoreTarget();
    return () => {};
  }

  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    keys.forEach((key) => sessionStorage.removeItem(key));
    clearScrollRestoreTarget();
    return () => {};
  }

  const fallbackY = Number(saved?.y);
  if (!Number.isFinite(fallbackY) && saved?.carId == null) {
    keys.forEach((key) => sessionStorage.removeItem(key));
    clearScrollRestoreTarget();
    return () => {};
  }

  const timeoutIds = [];
  let frameId = null;
  let nestedFrameId = null;
  let finished = false;

  const cleanupStorage = () => {
    if (finished) return;
    finished = true;
    keys.forEach((key) => sessionStorage.removeItem(key));
    clearScrollRestoreTarget();
  };

  const restore = () => {
    let targetY = Number.isFinite(fallbackY) ? fallbackY : 0;
    const savedCardTop = Number(saved?.cardTop);
    let foundCard = false;

    if (saved?.carId != null && Number.isFinite(savedCardTop) && cardDataAttr) {
      const card = document.querySelector(`[${cardDataAttr}="${String(saved.carId)}"]`);
      if (card) {
        // Сначала грубо к сохранённому Y, затем точная подгонка относительно карточки.
        if (Number.isFinite(fallbackY)) {
          window.scrollTo({ top: Math.max(0, fallbackY), behavior: "auto" });
        }
        targetY = window.scrollY + card.getBoundingClientRect().top - savedCardTop;
        foundCard = true;
      }
    }

    window.scrollTo({ top: Math.max(0, targetY), behavior: "auto" });
    return foundCard || Number.isFinite(fallbackY);
  };

  // До первого paint — меньше заметного скачка с нуля.
  restore();

  frameId = window.requestAnimationFrame(() => {
    nestedFrameId = window.requestAnimationFrame(() => {
      restore();
      const delays = [50, 100, 200, 400, 800, 1200];
      delays.forEach((delay, index) => {
        timeoutIds.push(
          window.setTimeout(() => {
            const ok = restore();
            // После появления карточки в DOM можно завершать; иначе — на последней попытке.
            if ((ok && foundCardReady()) || index === delays.length - 1) {
              cleanupStorage();
            }
          }, delay)
        );
      });
    });
  });

  function foundCardReady() {
    if (saved?.carId == null || !cardDataAttr) return Number.isFinite(fallbackY);
    return Boolean(document.querySelector(`[${cardDataAttr}="${String(saved.carId)}"]`));
  }

  return () => {
    if (frameId != null) window.cancelAnimationFrame(frameId);
    if (nestedFrameId != null) window.cancelAnimationFrame(nestedFrameId);
    timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
  };
}
