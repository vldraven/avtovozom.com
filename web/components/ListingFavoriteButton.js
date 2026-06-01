import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";

import AuthPromptModal from "./AuthPromptModal";
import { getStoredToken } from "../lib/auth";
import { addFavorite, fetchFavoriteCarIds, removeFavorite } from "../lib/favorites";
import { publicCarHref } from "../lib/carRoutes";

function IconHeart({ filled }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={filled ? "currentColor" : "none"}
      />
    </svg>
  );
}

/**
 * @param {{ carId: number, car?: object | null, variant?: "chip" | "overlay" }} props
 */
export default function ListingFavoriteButton({ carId, car = null, variant = "chip" }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [favorited, setFavorited] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const refreshToken = useCallback(() => {
    setToken(getStoredToken());
  }, []);

  useEffect(() => {
    refreshToken();
    const onToken = () => refreshToken();
    if (typeof window === "undefined") return undefined;
    window.addEventListener("avt-token-changed", onToken);
    window.addEventListener("storage", onToken);
    return () => {
      window.removeEventListener("avt-token-changed", onToken);
      window.removeEventListener("storage", onToken);
    };
  }, [refreshToken]);

  const syncFavorited = useCallback(async () => {
    if (!token || !carId) {
      setFavorited(false);
      setReady(true);
      return;
    }
    try {
      const ids = await fetchFavoriteCarIds(token);
      setFavorited(ids.includes(Number(carId)));
    } catch {
      setFavorited(false);
    } finally {
      setReady(true);
    }
  }, [token, carId]);

  useEffect(() => {
    setReady(false);
    syncFavorited();
  }, [syncFavorited]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onFav = () => syncFavorited();
    window.addEventListener("avt-favorites-changed", onFav);
    return () => window.removeEventListener("avt-favorites-changed", onFav);
  }, [syncFavorited]);

  const nextPath = car ? publicCarHref(car) : router.asPath || `/cars/${carId}`;

  function onPointerEvent(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  async function onClick(e) {
    onPointerEvent(e);
    if (busy) return;
    if (!token) {
      setAuthModalOpen(true);
      return;
    }
    setBusy(true);
    const nextFav = !favorited;
    setFavorited(nextFav);
    try {
      if (nextFav) {
        await addFavorite(token, carId);
      } else {
        await removeFavorite(token, carId);
      }
    } catch {
      setFavorited(!nextFav);
    } finally {
      setBusy(false);
    }
  }

  const label = favorited ? "Убрать из избранного" : "Добавить в избранное";
  const isOverlay = variant === "overlay";
  const btnClass = [
    "listing-favorite__btn",
    isOverlay ? "listing-favorite__btn--overlay" : "listing-action-btn",
    favorited ? "listing-favorite__btn--on" : "",
    !ready ? "listing-favorite__btn--loading" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <button
        type="button"
        className={btnClass}
        onClick={onClick}
        onPointerDown={onPointerEvent}
        disabled={busy}
        aria-pressed={favorited}
        aria-label={label}
        title={label}
      >
        <IconHeart filled={favorited} />
      </button>
      <AuthPromptModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        title="Войдите, чтобы сохранить в избранное"
        description="После входа объявление можно добавить в список избранного — он доступен в вашем аккаунте."
        nextPath={nextPath}
      />
    </>
  );
}
