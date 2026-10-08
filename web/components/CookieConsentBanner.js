import Link from "next/link";
import { useEffect, useState } from "react";

import { getCookieConsent, setCookieConsent } from "../lib/cookieConsent";

export default function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(!getCookieConsent());
  }, []);

  if (!visible) return null;

  return (
    <div className="cookie-consent" role="dialog" aria-label="Согласие на cookies">
      <p className="cookie-consent__text">
        Мы используем cookies и Яндекс.Метрику для работы сайта и статистики. Подробнее — в{" "}
        <Link href="/privacy">политике обработки персональных данных</Link>.
      </p>
      <div className="cookie-consent__actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            setCookieConsent("declined");
            setVisible(false);
          }}
        >
          Только необходимые
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => {
            setCookieConsent("accepted");
            setVisible(false);
          }}
        >
          Принять
        </button>
      </div>
    </div>
  );
}
