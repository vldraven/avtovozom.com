/** Держать в паре с backend/app/pd_consent.py CONSENT_VERSION. */
export const PD_CONSENT_VERSION = "2026-11-18";

const GUEST_KEY = "avtovozom_guest_pd_consent_version";

export function processingConsentFields({ termsAccepted = true } = {}) {
  return {
    pd_consent: true,
    terms_accepted: Boolean(termsAccepted),
    consent_version: PD_CONSENT_VERSION,
  };
}

export function guestPdConsentGranted() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(GUEST_KEY) === PD_CONSENT_VERSION;
  } catch {
    return false;
  }
}

export function rememberGuestPdConsent() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GUEST_KEY, PD_CONSENT_VERSION);
  } catch {
    /* ignore */
  }
}

export function forgetGuestPdConsent() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(GUEST_KEY);
  } catch {
    /* ignore */
  }
}

export async function logCookieChoice(choice) {
  const api = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  try {
    await fetch(`${api}/public/pd-consents/cookies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice, consent_version: PD_CONSENT_VERSION }),
    });
  } catch {
    /* журнал не блокирует выбор в браузере */
  }
}
