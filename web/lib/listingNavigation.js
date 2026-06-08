/** Страница-источник для кнопки «Назад» из карточки объявления. */
const RETURN_PATH_KEY = "avt_listing_return_path";

function isListingDetailPath(path) {
  const base = String(path || "").split("?")[0];
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

export function peekListingReturnPath() {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(RETURN_PATH_KEY);
}

export function consumeListingReturnPath() {
  const path = peekListingReturnPath();
  if (path) sessionStorage.removeItem(RETURN_PATH_KEY);
  return path;
}
