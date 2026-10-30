const STORAGE_KEY = "avtovozom_cookie_consent_v1";
let sessionConsent = null;
let persistenceFailed = false;

export function getCookieConsent() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (persistenceFailed) return sessionConsent;
    if (raw === "accepted" || raw === "declined") return raw;
  } catch {
    return sessionConsent;
  }
  return null;
}

export function setCookieConsent(value) {
  if (typeof window === "undefined" || !["accepted", "declined"].includes(value)) return;
  sessionConsent = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
    persistenceFailed = false;
  } catch {
    persistenceFailed = true;
    /* Keep the choice for this page when storage is unavailable. */
  }
  window.dispatchEvent(new CustomEvent("avtovozom:cookie-consent", { detail: value }));
}
