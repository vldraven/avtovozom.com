import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const profileIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path
      d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * Ссылка «Профиль» в шапке: точка, если есть непросмотренные расчёты дилеров по заявкам (как в разделе профиля).
 * layout="dock" — нижняя панель на мобильных (variant зарезервирован под btn-secondary/ghost).
 */
export default function HeaderProfileLink({
  token,
  userRole,
  variant = "secondary",
  className = "",
  layout = "header",
}) {
  const router = useRouter();
  const [unreadOffers, setUnreadOffers] = useState(0);

  const refresh = useCallback(async () => {
    if (!token || userRole === "dealer") {
      setUnreadOffers(0);
      return;
    }
    const res = await fetch(`${API_URL}/requests/my`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    const sum = (data || []).reduce((s, r) => s + (Number(r.unread_offers_count) || 0), 0);
    setUnreadOffers(sum);
  }, [token, userRole]);

  useEffect(() => {
    refresh();
    if (!token) return undefined;
    const id = setInterval(refresh, 28000);
    const onFocus = () => refresh();
    const onUpdated = () => refresh();
    if (typeof window !== "undefined") {
      window.addEventListener("focus", onFocus);
      window.addEventListener("avt-requests-updated", onUpdated);
    }
    return () => {
      clearInterval(id);
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("avt-requests-updated", onUpdated);
      }
    };
  }, [token, refresh]);

  if (!token) return null;

  const active = router.pathname === "/profile";

  if (layout === "dock") {
    return (
      <Link
        href="/profile"
        className={`mobile-dock__item${active ? " mobile-dock__item--active" : ""}`}
        aria-current={active ? "page" : undefined}
        aria-label={
          unreadOffers > 0
            ? `Профиль, новые расчёты по заявкам: ${unreadOffers}`
            : "Профиль"
        }
        title={unreadOffers > 0 ? "В профиле есть непросмотренные расчёты дилеров — откройте «Мои заявки»" : undefined}
      >
        <span className="mobile-dock__icon">{profileIcon}</span>
        <span className="mobile-dock__label">Профиль</span>
        {unreadOffers > 0 ? <span className="mobile-dock__badge mobile-dock__badge--dot" aria-hidden /> : null}
      </Link>
    );
  }

  const base =
    variant === "ghost"
      ? `btn btn-ghost btn-sm header-profile-link ${className}`.trim()
      : `btn btn-secondary btn-sm header-profile-link ${className}`.trim();

  return (
    <Link
      href="/profile"
      className={base}
      aria-label={
        unreadOffers > 0
          ? `Профиль, новые расчёты по заявкам: ${unreadOffers}`
          : "Профиль"
      }
      title={unreadOffers > 0 ? "В профиле есть непросмотренные расчёты дилеров — откройте «Мои заявки»" : undefined}
    >
      Профиль
      {unreadOffers > 0 ? <span className="header-profile-link__badge" aria-hidden /> : null}
    </Link>
  );
}
