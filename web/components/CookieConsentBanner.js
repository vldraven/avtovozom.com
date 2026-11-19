import Link from "next/link";
import { useEffect, useState } from "react";

import { getCookieConsent, setCookieConsent } from "../lib/cookieConsent";
import { logCookieChoice } from "../lib/pdConsent";

export default function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const sync = () => setVisible(!getCookieConsent());
    const open = () => setVisible(true);
    sync();
    window.addEventListener("avtovozom:cookie-consent", sync);
    window.addEventListener("avtovozom:cookie-settings", open);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("avtovozom:cookie-consent", sync);
      window.removeEventListener("avtovozom:cookie-settings", open);
      window.removeEventListener("storage", sync);
    };
  }, []);

  function choose(value) {
    const hadAnalytics = getCookieConsent() === "accepted";
    setCookieConsent(value);
    logCookieChoice(value);
    setVisible(false);
    if (hadAnalytics && value === "declined") window.location.reload();
  }

  if (!visible) return null;

  return (
    <div className="cookie-consent" role="dialog" aria-label="Согласие на cookies">
      <p className="cookie-consent__text">
        Нужные cookies держат вход и запоминают этот выбор. Кнопка «Принять» отдельно разрешает
        Яндекс.Метрику: идентификатор посещения, просмотры и клики. Запись экрана и ввода с клавиатуры
        не ведётся. Подробнее — в <Link href="/consent">согласии</Link> и{" "}
        <Link href="/privacy">политике</Link>.
      </p>
      <div className="cookie-consent__actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => choose("declined")}>
          Только необходимые
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => choose("accepted")}>
          Принять
        </button>
      </div>
    </div>
  );
}
