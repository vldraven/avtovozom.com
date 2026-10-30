import { useEffect, useMemo, useState } from "react";
import { getCookieConsent } from "../lib/cookieConsent";

const DISMISSED_KEY = "avt_pwa_install_dismissed_until";
const DISMISS_MS = 14 * 24 * 60 * 60 * 1000;

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true
  );
}

function isMobile() {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent || "");
}

function isIos() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent || "");
}

export default function PwaInstallPrompt({ suppressed = false, onOpenChange }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const ios = useMemo(() => isIos(), []);

  useEffect(() => {
    if (typeof window === "undefined" || !isMobile() || isStandalone()) return undefined;
    let dismissedUntil = 0;
    try {
      dismissedUntil = Number(localStorage.getItem(DISMISSED_KEY) || "0");
    } catch {
      /* Storage may be unavailable in private browsing. */
    }
    if (dismissedUntil > Date.now()) return undefined;

    // First visit belongs to cookie choice and browsing, not another prompt.
    const returningVisit = Boolean(getCookieConsent());
    const timer = returningVisit ? setTimeout(() => {
      setReady(true);
      if (ios) setVisible(true);
    }, 30_000) : null;

    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [ios]);

  const shown = visible && ready && !suppressed;
  useEffect(() => {
    onOpenChange?.(shown);
  }, [shown, onOpenChange]);

  if (!shown) return null;

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now() + DISMISS_MS));
    } catch {
      /* Dismiss for this page even when the browser blocks storage. */
    }
  }

  async function confirm() {
    if (!deferredPrompt) {
      dismiss();
      return;
    }
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => null);
    setDeferredPrompt(null);
    dismiss();
  }

  return (
    <aside className="pwa-install" role="dialog" aria-modal="true" aria-live="polite" aria-label="Установка приложения">
      <button type="button" className="pwa-install__backdrop" aria-label="Закрыть подсказку" onClick={dismiss} />
      <div className="pwa-install__sheet">
        <div className="pwa-install__grabber" aria-hidden />
        <div className="pwa-install__content">
          <strong>Установить приложение Автовозом</strong>
          <p>
            {deferredPrompt
              ? "Добавьте сайт на рабочий стол и открывайте его как мобильное приложение."
              : 'Нажмите "Поделиться" а затем "Добавить на экран Домой".'}
          </p>
        </div>
        <div className="pwa-install__actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={confirm}>
            Хорошо
          </button>
        </div>
      </div>
    </aside>
  );
}
