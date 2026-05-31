import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  SHARE_NETWORK_IDS,
  buildListingSharePayload,
  canUseNativeShare,
  copyListingLink,
  openShareNetwork,
  shareListingNative,
  shareNetworkLabel,
} from "../lib/shareListing";

/** Lucide «share» (ISC) — https://lucide.dev/icons/share */
function IconShare() {
  return (
    <span className="listing-share__icon" aria-hidden>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M16 6 12 2 8 6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M12 2v13"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function IconLink() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M10 13a5 5 0 007.07 0l1.41-1.41a5 5 0 00-7.07-7.07L10 5M14 11a5 5 0 00-7.07 0L5.52 12.41a5 5 0 007.07 7.07L14 19"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NetworkIcon({ id }) {
  if (id === "vk") {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
        <rect width="24" height="24" rx="6" fill="#0077FF" />
        <path
          fill="#fff"
          d="M12.82 16.5h.72c.28 0 .5-.06.66-.18.15-.12.28-.34.38-.66l.54-1.78c.14-.45.29-.76.46-.94.08-.08.17-.12.27-.12.1 0 .24.08.42.24l1.12 1.05c.36.33.63.5.8.5h1.45c.4 0 .6-.19.6-.58 0-.1-.02-.2-.05-.3-.16-.45-.74-1.08-1.74-1.88-.74-.58-1.24-1.02-1.5-1.32-.32-.38-.03-.58.24-.94.16-.21 3.6-3.32 3.67-3.6.08-.28-.06-.42-.34-.42h-1.45c-.3 0-.55.1-.75.3l-1.78 1.86c-.14.14-.28.22-.42.22-.08 0-.15-.04-.22-.1-.06-.06-.1-.15-.1-.28V8.5c0-.25-.08-.42-.24-.52-.16-.1-.4-.15-.72-.15h-2.28c-.5 0-.75.25-.75.75 0 .78-.42 1.16-1.62 1.16-.3 0-.52.06-.66.18-.14.12-.21.3-.21.54v1.1c0 .2-.06.36-.18.48-.12.12-.28.18-.48.18-.4 0-.9-.32-1.5-.96-.6-.64-1.05-1.4-1.35-2.28-.14-.4-.3-.6-.48-.6H5.5c-.4 0-.6.19-.6.58 0 .12.02.26.06.42.5 1.68 1.48 3.18 2.94 4.5 1.46 1.32 3.06 1.98 4.8 1.98z"
        />
      </svg>
    );
  }
  if (id === "ok") {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
        <rect width="24" height="24" rx="6" fill="#EE8208" />
        <path
          fill="#fff"
          d="M12 6.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zm0 5.5a2 2 0 110-4 2 2 0 010 4zm4.8 2.2a.75.75 0 00-1.06 0l-1.24 1.24-1.24-1.24a.75.75 0 10-1.06 1.06l1.24 1.24-1.24 1.24a.75.75 0 101.06 1.06l1.24-1.24 1.24 1.24a.75.75 0 101.06-1.06l-1.24-1.24 1.24-1.24a.75.75 0 000-1.06z"
        />
      </svg>
    );
  }
  if (id === "whatsapp") {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
        <rect width="24" height="24" rx="6" fill="#25D366" />
        <path
          fill="#fff"
          d="M17.5 14.2c-.3-.15-1.7-.84-1.96-.94-.26-.1-.45-.15-.64.15-.19.3-.74.94-.9 1.13-.17.19-.33.21-.62.07-.3-.15-1.24-.46-2.36-1.46-.87-.78-1.46-1.74-1.63-2.03-.17-.3-.02-.46.13-.61.13-.13.3-.33.45-.5.15-.17.2-.29.3-.48.1-.19.05-.37-.02-.52-.07-.15-.64-1.54-.88-2.1-.23-.56-.46-.48-.64-.49h-.55c-.19 0-.5.07-.76.37-.26.3-1 1-1 2.43 0 1.43 1.03 2.81 1.17 3 .15.19 2.03 3.1 4.92 4.35.69.3 1.22.48 1.64.61.69.22 1.32.19 1.82.12.56-.08 1.7-.7 1.94-1.37.24-.67.24-1.24.17-1.37-.07-.13-.26-.2-.56-.35z"
        />
      </svg>
    );
  }
  if (id === "telegram") {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
        <rect width="24" height="24" rx="6" fill="#2AABEE" />
        <path
          fill="#fff"
          d="M17.8 7.2l-2.2 10.4c-.16.72-.58.9-1.18.56l-3.26-2.4-1.57 1.52c-.18.18-.33.33-.67.33l.24-3.4 6.04-5.46c.26-.23-.06-.36-.4-.13L8.2 13.5 5 12.4c-.68-.22-.7-.68.14-1.02l10.66-4.1c.56-.2 1.05.14.9 1.02z"
        />
      </svg>
    );
  }
  return null;
}

function useIsMobileShare() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return isMobile;
}

/**
 * @param {{ car: object, totalRubRf?: number | null }} props
 */
export default function ListingShareActions({ car, totalRubRf = null }) {
  const rootRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const isMobile = useIsMobileShare();

  const payload = useMemo(
    () => buildListingSharePayload(car, totalRubRf),
    [car, totalRubRf]
  );

  const showNotice = useCallback((msg) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(""), 2800);
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await copyListingLink(payload.url);
      showNotice("Ссылка скопирована");
      setMenuOpen(false);
    } catch {
      showNotice("Не удалось скопировать ссылку");
    }
  }, [payload.url, showNotice]);

  const handleNativeShare = useCallback(async () => {
    if (canUseNativeShare()) {
      try {
        await shareListingNative(payload);
      } catch {
        showNotice("Не удалось поделиться");
      }
      return;
    }
    await handleCopy();
  }, [payload, handleCopy, showNotice]);

  const handleTriggerClick = useCallback(() => {
    if (isMobile) {
      handleNativeShare();
      return;
    }
    setMenuOpen((open) => !open);
  }, [isMobile, handleNativeShare]);

  useEffect(() => {
    if (!menuOpen || isMobile) return;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, isMobile]);

  return (
    <div className="listing-share" ref={rootRef}>
      <button
        type="button"
        className="listing-share__trigger"
        aria-label="Поделиться"
        aria-expanded={!isMobile && menuOpen}
        aria-haspopup={!isMobile ? "menu" : undefined}
        onClick={handleTriggerClick}
      >
        <IconShare />
      </button>

      {!isMobile && menuOpen ? (
        <ul className="listing-share__menu" role="menu">
          {SHARE_NETWORK_IDS.map((id) => (
            <li key={id} role="none">
              <button
                type="button"
                className="listing-share__item"
                role="menuitem"
                onClick={() => {
                  openShareNetwork(id, payload);
                  setMenuOpen(false);
                }}
              >
                <span className="listing-share__item-icon">
                  <NetworkIcon id={id} />
                </span>
                <span className="listing-share__item-label">{shareNetworkLabel(id)}</span>
              </button>
            </li>
          ))}
          <li role="none">
            <button type="button" className="listing-share__item" role="menuitem" onClick={handleCopy}>
              <span className="listing-share__item-icon listing-share__item-icon--muted">
                <IconLink />
              </span>
              <span className="listing-share__item-label">Скопировать ссылку</span>
            </button>
          </li>
        </ul>
      ) : null}

      {notice ? <p className="listing-share__notice">{notice}</p> : null}
    </div>
  );
}
