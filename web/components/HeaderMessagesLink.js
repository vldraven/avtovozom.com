import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const messagesIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path
      d="M4 5.5C4 4.67 4.67 4 5.5 4h13c.83 0 1.5.67 1.5 1.5v9c0 .83-.67 1.5-1.5 1.5H9l-4 3v-3H5.5A1.5 1.5 0 0 1 4 15.5v-10Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * Иконка «Сообщения» в шапке в духе маркетплейсов: красная точка при непрочитанных.
 * variant="dock" — нижняя панель на мобильных.
 */
export default function HeaderMessagesLink({ token, variant = "header" }) {
  const router = useRouter();
  const [unreadTotal, setUnreadTotal] = useState(0);

  const refresh = useCallback(async () => {
    if (!token) {
      setUnreadTotal(0);
      return;
    }
    const res = await fetch(`${API_URL}/chats/my`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    const sum = (data || []).reduce((s, c) => s + (Number(c.unread_count) || 0), 0);
    setUnreadTotal(sum);
  }, [token]);

  useEffect(() => {
    refresh();
    if (!token) return undefined;
    const id = setInterval(refresh, 28000);
    const onFocus = () => refresh();
    if (typeof window !== "undefined") {
      window.addEventListener("focus", onFocus);
    }
    return () => {
      clearInterval(id);
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
      }
    };
  }, [token, refresh]);

  if (!token) return null;

  const active = router.pathname === "/messages";

  if (variant === "dock") {
    return (
      <Link
        href="/messages"
        className={`mobile-dock__item${active ? " mobile-dock__item--active" : ""}`}
        aria-current={active ? "page" : undefined}
        aria-label="Сообщения"
      >
        <span className="mobile-dock__icon">{messagesIcon}</span>
        <span className="mobile-dock__label">Чаты</span>
        {unreadTotal > 0 ? (
          <span className="mobile-dock__badge mobile-dock__badge--dot" title="Непрочитанные" />
        ) : null}
      </Link>
    );
  }

  return (
    <Link href="/messages" className="header-messages-link" aria-label="Сообщения">
      <span className="header-messages-link__icon" aria-hidden>
        {messagesIcon}
      </span>
      <span className="header-messages-link__label">Сообщения</span>
      {unreadTotal > 0 ? <span className="header-messages-link__badge" title="Непрочитанные" /> : null}
    </Link>
  );
}
