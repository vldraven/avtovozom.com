/**
 * Надёжный сброс window scroll в 0 (iOS Safari / standalone WebKit).
 * Обычный window.scrollTo(0) часто перетирается layout/картинками и
 * html { scroll-behavior: smooth }.
 */
export function forceScrollTop() {
  if (typeof window === "undefined") return;

  const root = document.documentElement;
  const prevBehavior = root.style.scrollBehavior;
  root.style.scrollBehavior = "auto";

  try {
    window.scrollTo(0, 0);
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    root.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  } finally {
    root.style.scrollBehavior = prevBehavior;
  }
}

/**
 * Сброс сразу + повторы после paint/layout (типичный iOS-сценарий список → карточка).
 * Возвращает cleanup.
 */
export function scheduleForceScrollTop({ delays = [50, 100, 200, 400, 800] } = {}) {
  if (typeof window === "undefined") return () => {};

  let previousRestoration;
  if ("scrollRestoration" in window.history) {
    previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
  }

  const timeoutIds = [];
  let frameId = null;
  let nestedFrameId = null;

  forceScrollTop();

  frameId = window.requestAnimationFrame(() => {
    forceScrollTop();
    nestedFrameId = window.requestAnimationFrame(() => {
      forceScrollTop();
      delays.forEach((delay) => {
        timeoutIds.push(window.setTimeout(forceScrollTop, delay));
      });
    });
  });

  return () => {
    if (frameId != null) window.cancelAnimationFrame(frameId);
    if (nestedFrameId != null) window.cancelAnimationFrame(nestedFrameId);
    timeoutIds.forEach((id) => window.clearTimeout(id));
    if (previousRestoration != null && "scrollRestoration" in window.history) {
      window.history.scrollRestoration = previousRestoration;
    }
  };
}
