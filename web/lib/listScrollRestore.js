/**
 * Восстановление позиции скролла списка объявлений после возврата из карточки.
 * Возвращает функцию очистки таймеров / rAF.
 */
export function scheduleListScrollRestore({ storagePrefix, path, cardDataAttr }) {
  if (typeof window === "undefined" || !path) return () => {};

  const storageKey = `${storagePrefix}${path}`;
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) return () => {};

  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    sessionStorage.removeItem(storageKey);
    return () => {};
  }

  sessionStorage.removeItem(storageKey);
  const timeoutIds = [];
  let frameId = null;
  let nestedFrameId = null;

  const restore = () => {
    const fallbackY = Number(saved?.y);
    let targetY = Number.isFinite(fallbackY) ? fallbackY : 0;
    const savedCardTop = Number(saved?.cardTop);
    if (saved?.carId != null && Number.isFinite(savedCardTop) && cardDataAttr) {
      const card = document.querySelector(`[${cardDataAttr}="${String(saved.carId)}"]`);
      if (card) {
        card.scrollIntoView({ block: "center", behavior: "auto" });
        targetY = window.scrollY + card.getBoundingClientRect().top - savedCardTop;
      }
    }
    window.scrollTo({ top: Math.max(0, targetY), behavior: "auto" });
  };

  frameId = window.requestAnimationFrame(() => {
    nestedFrameId = window.requestAnimationFrame(() => {
      restore();
      [0, 50, 150, 300, 700, 1200].forEach((delay) => {
        timeoutIds.push(window.setTimeout(restore, delay));
      });
    });
  });

  return () => {
    if (frameId != null) window.cancelAnimationFrame(frameId);
    if (nestedFrameId != null) window.cancelAnimationFrame(nestedFrameId);
    timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
  };
}
