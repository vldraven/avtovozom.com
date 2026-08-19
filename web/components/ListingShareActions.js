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

function IconShare() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/icons/share-arrow.png"
      alt=""
      width={20}
      height={20}
      draggable={false}
      className="listing-share__icon-img"
    />
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
      <svg width="20" height="20" viewBox="0 0 48 48" fill="none" aria-hidden>
        <path d="M0 23.04C0 12.1788 0 6.74826 3.37413 3.37413C6.74826 0 12.1788 0 23.04 0H24.96C35.8212 0 41.2517 0 44.6259 3.37413C48 6.74826 48 12.1788 48 23.04V24.96C48 35.8212 48 41.2517 44.6259 44.6259C41.2517 48 35.8212 48 24.96 48H23.04C12.1788 48 6.74826 48 3.37413 44.6259C0 41.2517 0 35.8212 0 24.96V23.04Z" fill="#0077FF"/>
        <path d="M25.54 34.5801C14.6 34.5801 8.3601 27.0801 8.1001 14.6001H13.5801C13.7601 23.7601 17.8 27.6401 21 28.4401V14.6001H26.1602V22.5001C29.3202 22.1601 32.6398 18.5601 33.7598 14.6001H38.9199C38.0599 19.4801 34.4599 23.0801 31.8999 24.5601C34.4599 25.7601 38.5601 28.9001 40.1201 34.5801H34.4399C33.2199 30.7801 30.1802 27.8401 26.1602 27.4401V34.5801H25.54Z" fill="white"/>
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
 * @param {{ car: object, totalRubRf?: number | null, variant?: "chip" | "labeled" }} props
 */
export default function ListingShareActions({ car, totalRubRf = null, variant = "chip" }) {
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

  const isLabeled = variant === "labeled";

  return (
    <div className={`listing-share${isLabeled ? " listing-share--labeled" : ""}`} ref={rootRef}>
      <button
        type="button"
        className={`listing-action-btn listing-share__trigger${isLabeled ? " listing-action-btn--labeled" : ""}`}
        aria-label="Поделиться"
        aria-expanded={!isMobile && menuOpen}
        aria-haspopup={!isMobile ? "menu" : undefined}
        onClick={handleTriggerClick}
      >
        <IconShare />
        {isLabeled ? <span className="listing-action-btn__text">Поделиться</span> : null}
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
