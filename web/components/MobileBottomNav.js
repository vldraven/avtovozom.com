import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";

import { getStoredToken } from "../lib/auth";
import { canCreateListings } from "../lib/roles";
import HeaderFavoritesLink from "./HeaderFavoritesLink";
import HeaderMessagesLink from "./HeaderMessagesLink";
import HeaderProfileLink from "./HeaderProfileLink";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function CatalogIcon() {
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

function AddListingIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
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
      const res = await fetch(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (cancelled) return;
      if (res.ok) setMe(await res.json());
      else setMe(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const root = document.documentElement;
    const vv = window.visualViewport;

    const updateViewportOffset = () => {
      const visual = window.visualViewport;
      if (!visual) {
        root.style.setProperty("--mobile-viewport-offset", "0px");
        return;
      }
      const layoutHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const offset = Math.max(0, layoutHeight - visual.height - visual.offsetTop);
      root.style.setProperty("--mobile-viewport-offset", `${Math.round(offset)}px`);
    };

    updateViewportOffset();
    window.addEventListener("resize", updateViewportOffset);
    window.addEventListener("orientationchange", updateViewportOffset);
    vv?.addEventListener("resize", updateViewportOffset);
    vv?.addEventListener("scroll", updateViewportOffset);

    return () => {
      window.removeEventListener("resize", updateViewportOffset);
      window.removeEventListener("orientationchange", updateViewportOffset);
      vv?.removeEventListener("resize", updateViewportOffset);
      vv?.removeEventListener("scroll", updateViewportOffset);
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
  if (messagesThreadOpen) return null;

  const isCatalogNav =
    router.pathname === "/catalog" || router.pathname.startsWith("/catalog/");
  const showAdd = Boolean(token && canCreateListings(me?.role));
  const colCount = !token ? 2 : 4 + (showAdd ? 1 : 0);
  const staffListingActive =
    router.pathname === "/staff/new-listing" || router.pathname === "/staff/edit-listing";

  return (
    <nav className="mobile-bottom-nav" aria-label="Основная навигация по сайту">
      <div
        className="mobile-bottom-nav__inner"
        style={{ "--mobile-dock-cols": String(colCount) }}
      >
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

        {!token ? (
          <Link href={`/auth?next=${encodeURIComponent(router.asPath || "/")}`} className="mobile-dock__item">
            <span className="mobile-dock__icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                <circle cx="12" cy="9" r="3.5" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="M6.5 19.5a5.5 5.5 0 0 1 11 0"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className="mobile-dock__label">Войти</span>
          </Link>
        ) : (
          <>
            <HeaderMessagesLink token={token} variant="dock" />
            <HeaderProfileLink token={token} userRole={me?.role} layout="dock" />
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
            <HeaderFavoritesLink token={token} variant="dock" />
          </>
        )}
      </div>
    </nav>
  );
}
