import { requestCookieSettings } from "../lib/cookieConsent";

export default function CookieSettingsLink() {
  return (
    <button type="button" className="site-footer__cookie" onClick={() => requestCookieSettings()}>
      Настройки cookies
    </button>
  );
}
