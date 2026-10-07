const STORAGE_KEY = "avtovozom_cookie_consent_v1";

export function getCookieConsent() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "accepted" || raw === "declined") return raw;
  } catch {
    /* ignore */
  }
  return null;
}

export function setCookieConsent(value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
    window.dispatchEvent(new CustomEvent("avtovozom:cookie-consent", { detail: value }));
  } catch {
    /* ignore */
  }
}
