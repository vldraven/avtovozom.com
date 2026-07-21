import {
  clearScrollRestoreTarget,
  pathsMatchForScrollRestore,
  peekScrollRestoreTarget,
} from "./listingNavigation";

const ALIGN_PX = 2;

/**
 * Мгновенный scrollTo: глобальный `html { scroll-behavior: smooth }` иначе
 * анимирует даже `behavior: "auto"` и портит UX при возврате из карточки.
 */
function scrollToInstant(top) {
  const y = Math.max(0, top);
  try {
    window.scrollTo({ top: y, left: 0, behavior: "instant" });
  } catch {
    window.scrollTo(0, y);
  }
}

function isAligned(targetY) {
  return Math.abs(window.scrollY - Math.max(0, targetY)) <= ALIGN_PX;
}

/**
 * Восстановление позиции скролла списка объявлений после возврата из карточки.
 * Позиция выставляется мгновенно (без анимации). Возвращает функцию очистки.
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

  // Пока идут retry (Next.js может сбросить скролл наверх после mount),
  // держим scroll-behavior без smooth — иначе каждый retry анимируется.
  const html = document.documentElement;
  const previousScrollBehavior = html.style.scrollBehavior;
  html.style.scrollBehavior = "auto";

  const cleanupStorage = () => {
    if (finished) return;
    finished = true;
    keys.forEach((key) => sessionStorage.removeItem(key));
    clearScrollRestoreTarget();
    html.style.scrollBehavior = previousScrollBehavior;
  };

  const foundCardReady = () => {
    if (saved?.carId == null || !cardDataAttr) return Number.isFinite(fallbackY);
    return Boolean(document.querySelector(`[${cardDataAttr}="${String(saved.carId)}"]`));
  };

  const resolveTargetY = () => {
    let targetY = Number.isFinite(fallbackY) ? fallbackY : 0;
    let foundCard = false;
    const savedCardTop = Number(saved?.cardTop);

    if (saved?.carId != null && Number.isFinite(savedCardTop) && cardDataAttr) {
      const card = document.querySelector(`[${cardDataAttr}="${String(saved.carId)}"]`);
      if (card) {
        targetY = window.scrollY + card.getBoundingClientRect().top - savedCardTop;
        foundCard = true;
      }
    }

    return { targetY, foundCard };
  };

  const restore = () => {
    const { targetY, foundCard } = resolveTargetY();
    if (!isAligned(targetY)) {
      scrollToInstant(targetY);
    }
    return { ok: foundCard || Number.isFinite(fallbackY), targetY, foundCard };
  };

  // Синхронно до paint вызывающего layout-effect — меньше кадра с y=0.
  restore();

  frameId = window.requestAnimationFrame(() => {
    nestedFrameId = window.requestAnimationFrame(() => {
      const { ok, targetY } = restore();
      if (ok && foundCardReady() && isAligned(targetY)) {
        cleanupStorage();
        return;
      }

      // Retry только против позднего сброса Next.js наверх; скролл всегда instant.
      const delays = [50, 100, 200, 400];
      delays.forEach((delay, index) => {
        timeoutIds.push(
          window.setTimeout(() => {
            if (finished) return;
            const result = restore();
            if (
              (result.ok && foundCardReady() && isAligned(result.targetY)) ||
              index === delays.length - 1
            ) {
              cleanupStorage();
            }
          }, delay)
        );
      });
    });
  });

  return () => {
    if (frameId != null) window.cancelAnimationFrame(frameId);
    if (nestedFrameId != null) window.cancelAnimationFrame(nestedFrameId);
    timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    if (!finished) {
      html.style.scrollBehavior = previousScrollBehavior;
    }
  };
}
