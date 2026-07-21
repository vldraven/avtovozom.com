/** Страница-источник для кнопки «Назад» из карточки объявления. */
const RETURN_PATH_KEY = "avt_listing_return_path";
const SCROLL_RESTORE_TARGET_KEY = "avt_listing_scroll_restore_target";

function normalizePath(path) {
  return String(path || "").split("?")[0] || "/";
}

function isListingDetailPath(path) {
  const base = normalizePath(path);
  if (/^\/cars\/\d+$/.test(base)) return true;
  return /^\/catalog\/[^/]+\/[^/]+\/\d+$/.test(base);
}

/** Запомнить список, с которого открыли карточку (не перезаписывать при переходе между карточками). */
export function saveListingReturnPath(path) {
  if (typeof window === "undefined" || !path) return;
  if (isListingDetailPath(path)) {
    if (sessionStorage.getItem(RETURN_PATH_KEY)) return;
    return;
  }
  sessionStorage.setItem(RETURN_PATH_KEY, path);
}

/** Разрешить восстановление скролла только после клика по карточке с этого списка. */
export function markScrollRestoreTarget(path) {
  if (typeof window === "undefined" || !path || isListingDetailPath(path)) return;
  sessionStorage.setItem(SCROLL_RESTORE_TARGET_KEY, path);
}

export function peekScrollRestoreTarget() {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(SCROLL_RESTORE_TARGET_KEY);
}

export function clearScrollRestoreTarget() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SCROLL_RESTORE_TARGET_KEY);
}

export function pathsMatchForScrollRestore(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return normalizePath(a) === normalizePath(b);
}

/** Возврат на список после клика по карточке — не перезагружаем ленту. */
export function isListingBackNavigation(path) {
  if (typeof window === "undefined" || !path) return false;
  const target = peekScrollRestoreTarget();
  return Boolean(target && pathsMatchForScrollRestore(target, path));
}

export function peekListingReturnPath() {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(RETURN_PATH_KEY);
}

export function consumeListingReturnPath() {
  const path = peekListingReturnPath();
  if (path) sessionStorage.removeItem(RETURN_PATH_KEY);
  return path;
}

/**
 * Сбросить restore-target только если уходим НЕ на список, с которого открыли карточку.
 * Важно: не чистить target при router.back() / «Назад» — иначе скролл не восстановится.
 */
export function handleListingDetailRouteChangeStart(url) {
  const restoreTarget = peekScrollRestoreTarget();
  if (restoreTarget && pathsMatchForScrollRestore(url, restoreTarget)) {
    return;
  }
  const returnPath = peekListingReturnPath();
  if (returnPath && pathsMatchForScrollRestore(url, returnPath)) {
    return;
  }
  clearScrollRestoreTarget();
}
