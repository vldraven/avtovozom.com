/** Страница-источник для кнопки «Назад» из карточки объявления. */
const RETURN_PATH_KEY = "avt_listing_return_path";
const SCROLL_RESTORE_TARGET_KEY = "avt_listing_scroll_restore_target";

function normalizePath(path) {
  return String(path || "").split("?")[0];
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

export function peekListingReturnPath() {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(RETURN_PATH_KEY);
}

export function consumeListingReturnPath() {
  const path = peekListingReturnPath();
  if (path) sessionStorage.removeItem(RETURN_PATH_KEY);
  return path;
}

/** Сбросить restore-target при уходе с карточки не «назад» в тот же список. */
export function handleListingDetailRouteChangeStart(url) {
  const returnPath = peekListingReturnPath();
  if (!returnPath) {
    clearScrollRestoreTarget();
    return;
  }
  if (normalizePath(url) !== normalizePath(returnPath)) {
    clearScrollRestoreTarget();
  }
}
