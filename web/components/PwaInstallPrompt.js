import { useEffect, useMemo, useState } from "react";

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

export default function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);
  const ios = useMemo(() => isIos(), []);

  useEffect(() => {
    if (typeof window === "undefined" || !isMobile() || isStandalone()) return undefined;
    const dismissedUntil = Number(localStorage.getItem(DISMISSED_KEY) || "0");
    if (dismissedUntil > Date.now()) return undefined;

    const timer = setTimeout(() => {
      if (ios) setVisible(true);
    }, 1800);

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

  if (!visible) return null;

  async function install() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => null);
    setDeferredPrompt(null);
    setVisible(false);
  }

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, String(Date.now() + DISMISS_MS));
    setVisible(false);
  }

  return (
    <aside className="pwa-install" role="dialog" aria-live="polite" aria-label="Установка приложения">
      <div>
        <strong>Установите avtovozom</strong>
        <p>
          {deferredPrompt
            ? "Добавьте сайт на рабочий стол и открывайте его как мобильное приложение."
            : "На iPhone нажмите «Поделиться», затем «На экран Домой»."}
        </p>
      </div>
      <div className="pwa-install__actions">
        {deferredPrompt ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={install}>
            Установить
          </button>
        ) : null}
        <button type="button" className="btn btn-ghost btn-sm" onClick={dismiss}>
          Не сейчас
        </button>
      </div>
    </aside>
  );
}
