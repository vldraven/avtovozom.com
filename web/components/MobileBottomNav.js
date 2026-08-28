import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";

import { getStoredToken } from "../lib/auth";
import { canCreateListings } from "../lib/roles";
import HeaderFavoritesLink from "./HeaderFavoritesLink";
import HeaderMessagesLink from "./HeaderMessagesLink";
import HeaderProfileLink from "./HeaderProfileLink";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function HomeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CatalogIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M5 5h6v6H5V5Zm8 0h6v6h-6V5ZM5 13h6v6H5v-6Zm8 0h6v6h-6v-6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AddListingIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function LoginIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="12" cy="9" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 19.5a5.5 5.5 0 0 1 11 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function dockAuthHref(path) {
  return `/auth?next=${encodeURIComponent(path)}`;
}

export default function MobileBottomNav() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [me, setMe] = useState(null);

  const refreshAuth = useCallback(() => {
    setToken(getStoredToken());
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth, router.asPath]);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === "avt_token" || e.key === null) refreshAuth();
    };
    const onTokenEvt = () => refreshAuth();
    if (typeof window === "undefined") return undefined;
    window.addEventListener("storage", onStorage);
    window.addEventListener("avt-token-changed", onTokenEvt);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("avt-token-changed", onTokenEvt);
    };
  }, [refreshAuth]);

  useEffect(() => {
    if (!token) {
      setMe(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (res.ok) setMe(await res.json());
        else setMe(null);
      } catch {
        if (!cancelled) setMe(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const root = document.documentElement;
    // Dock у низа layout viewport (под клавиатурой). Не поднимаем через
    // visualViewport — иначе при фокусе и скролле тапбар прыгает.
    root.style.setProperty("--mobile-viewport-offset", "0px");
    return () => {
      root.style.removeProperty("--mobile-viewport-offset");
    };
  }, []);

  if (router.pathname === "/auth") return null;

  const rawChat = router.query.chat;
  const messagesThreadOpen =
    router.pathname === "/messages" &&
    router.isReady &&
    rawChat != null &&
    rawChat !== "" &&
    String(Array.isArray(rawChat) ? rawChat[0] : rawChat).trim() !== "";

  // Guest chat opens the thread without ?chat= — hide dock via body class from messages.js
  const [messagesBodyThreadOpen, setMessagesBodyThreadOpen] = useState(false);
  const [chatEntryKbOpen, setChatEntryKbOpen] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const sync = () => {
      setMessagesBodyThreadOpen(document.body.classList.contains("messages-thread-open"));
      setChatEntryKbOpen(document.body.classList.contains("chat-entry-kb-open"));
    };
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  if (messagesThreadOpen || messagesBodyThreadOpen || chatEntryKbOpen) return null;

  const isHomeNav = router.pathname === "/";
  const isCatalogNav =
    router.pathname === "/catalog" || router.pathname === "/catalog/[[...slug]]" || router.pathname.startsWith("/cars/");
  const showAdd = Boolean(token && canCreateListings(me?.role));
  // 5 consumer tabs + optional «+» for dealer/admin (привычный путь)
  const colCount = 5 + (showAdd ? 1 : 0);
  const staffListingActive =
    router.pathname === "/staff/new-listing" || router.pathname === "/staff/edit-listing";
  const authNext = router.asPath || "/";

  return (
    <nav className="mobile-bottom-nav" aria-label="Основная навигация по сайту">
      <div className="mobile-bottom-nav__inner" style={{ "--mobile-dock-cols": String(colCount) }}>
        <Link
          href="/"
          className={`mobile-dock__item${isHomeNav ? " mobile-dock__item--active" : ""}`}
          aria-current={isHomeNav ? "page" : undefined}
        >
          <span className="mobile-dock__icon">
            <HomeIcon />
          </span>
          <span className="mobile-dock__label">Главная</span>
        </Link>

        <Link
          href="/catalog"
          className={`mobile-dock__item${isCatalogNav ? " mobile-dock__item--active" : ""}`}
          aria-current={isCatalogNav ? "page" : undefined}
        >
          <span className="mobile-dock__icon">
            <CatalogIcon />
          </span>
          <span className="mobile-dock__label">Каталог</span>
        </Link>

        {token ? (
          <HeaderMessagesLink token={token} variant="dock" />
        ) : (
          <Link href="/messages" className="mobile-dock__item">
            <span className="mobile-dock__icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                <path
                  d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8A2.5 2.5 0 0 1 17.5 17H9l-4 3v-3.5A2.5 2.5 0 0 1 4 14.5v-8Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="mobile-dock__label">Чаты</span>
          </Link>
        )}

        {token ? (
          <HeaderFavoritesLink token={token} variant="dock" />
        ) : (
          <Link href={dockAuthHref("/favorites")} className="mobile-dock__item">
            <span className="mobile-dock__icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                <path
                  d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="mobile-dock__label">Избранное</span>
          </Link>
        )}

        {showAdd ? (
          <Link
            href="/staff/new-listing"
            className={`mobile-dock__item${staffListingActive ? " mobile-dock__item--active" : ""}`}
            aria-current={staffListingActive ? "page" : undefined}
          >
            <span className="mobile-dock__icon">
              <AddListingIcon />
            </span>
            <span className="mobile-dock__label">Объявл.</span>
          </Link>
        ) : null}

        {token ? (
          <HeaderProfileLink token={token} me={me} layout="dock" />
        ) : (
          <Link href={dockAuthHref(authNext)} className="mobile-dock__item">
            <span className="mobile-dock__icon">
              <LoginIcon />
            </span>
            <span className="mobile-dock__label">Войти</span>
          </Link>
        )}
      </div>
    </nav>
  );
}
