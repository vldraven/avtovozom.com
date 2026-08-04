import { useRouter } from "next/router";
import Head from "next/head";
import { useEffect } from "react";

import "../lib/suppressExtensionErrors";
import AppLockGate from "../components/AppLockGate";
import MobileBottomNav from "../components/MobileBottomNav";
import PwaInstallPrompt from "../components/PwaInstallPrompt";
import PwaServiceWorker from "../components/PwaServiceWorker";
import SiteFooter from "../components/SiteFooter";
import YandexMetrika from "../components/YandexMetrika";
import { ensureFreshAccessToken } from "../lib/auth";
import { manrope } from "../lib/fonts";
import "../styles/globals.css";

/** Личные кабинеты и админка — не индексируем (дублирует robots.txt Disallow). */
function useSeoNoIndex() {
  const router = useRouter();
  const path = router.pathname || "";
  return (
    /^(?:\/auth|\/profile|\/messages|\/favorites|\/reset-password)(?:\/|$)/.test(path) ||
    path.startsWith("/staff/")
  );
}

export default function App({ Component, pageProps }) {
  const router = useRouter();
  const noindex = useSeoNoIndex();
  const path = router.pathname || "";
  const showFooter =
    !path.startsWith("/staff/") &&
    path !== "/auth" &&
    path !== "/reset-password" &&
    path !== "/messages";
  const showMobileBottomNav =
    path !== "/messages" && path !== "/auth" && path !== "/reset-password";

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const tick = () => ensureFreshAccessToken().catch(() => null);
    tick();
    const onFocus = () => tick();
    window.addEventListener("focus", onFocus);
    const id = setInterval(tick, 4 * 60 * 1000);

    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(id);
    };
  }, []);

  // iOS «На экран Домой» / PWA: class for safe-area under status bar & notch.
  // Scoped via html.is-standalone so in-browser layout is unchanged.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const syncStandalone = () => {
      const standalone = Boolean(
        window.matchMedia?.("(display-mode: standalone)")?.matches ||
          window.matchMedia?.("(display-mode: fullscreen)")?.matches ||
          window.navigator.standalone
      );
      document.documentElement.classList.toggle("is-standalone", standalone);
    };
    syncStandalone();
    const mqStandalone = window.matchMedia?.("(display-mode: standalone)");
    const mqFullscreen = window.matchMedia?.("(display-mode: fullscreen)");
    mqStandalone?.addEventListener?.("change", syncStandalone);
    mqFullscreen?.addEventListener?.("change", syncStandalone);
    return () => {
      mqStandalone?.removeEventListener?.("change", syncStandalone);
      mqFullscreen?.removeEventListener?.("change", syncStandalone);
      document.documentElement.classList.remove("is-standalone");
    };
  }, []);

  // MetaMask и другие расширения кидают unhandled rejection → Next.js overlay поверх страницы.
  useEffect(() => {
    if (typeof window === "undefined" || process.env.NODE_ENV === "production") {
      return undefined;
    }
    if (window.__AVTOVOZOM_EXTENSION_ERROR_GUARD__) {
      return undefined;
    }
    window.__AVTOVOZOM_EXTENSION_ERROR_GUARD__ = true;

    function isExtensionNoise(value) {
      const text = String(
        value?.message || value?.reason?.message || value?.reason || value || ""
      );
      const stack = String(value?.stack || value?.reason?.stack || "");
      return (
        /MetaMask|Failed to connect to MetaMask/i.test(text) ||
        /chrome-extension:\/\//i.test(stack) ||
        /chrome-extension:\/\//i.test(text)
      );
    }

    const onError = (event) => {
      if (!isExtensionNoise(event.error || event.message)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onRejection = (event) => {
      if (!isExtensionNoise(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection, true);
    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection, true);
    };
  }, []);

  return (
    <>
      <Head>
        <title>avtovozom — каталог автомобилей</title>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
        />
        <meta name="theme-color" content="#0f172a" />
        <meta name="application-name" content="avtovozom" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="avtovozom" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta
          name="description"
          content="Каталог автомобилей из Китая: подбор, доставка и сопровождение сделки."
        />
        <link rel="manifest" href="/manifest.webmanifest" />
        {noindex ? <meta name="robots" content="noindex, nofollow" /> : null}
        <meta property="og:site_name" content="avtovozom" />
        <meta property="og:locale" content="ru_RU" />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
      </Head>
      <div className={`app-chrome ${manrope.variable} ${manrope.className}`}>
        <AppLockGate>
          <Component {...pageProps} />
        </AppLockGate>
        {showFooter ? <SiteFooter /> : null}
        {showMobileBottomNav ? <MobileBottomNav /> : null}
        <PwaInstallPrompt />
        <PwaServiceWorker />
        <YandexMetrika />
      </div>
    </>
  );
}
