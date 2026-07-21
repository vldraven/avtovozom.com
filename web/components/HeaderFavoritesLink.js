import Link from "next/link";
import { useRouter } from "next/router";

const heartIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path
      d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * Ссылка «Избранное» в шапке и нижней панели.
 * variant="dock" — мобильный dock вместо «Выйти».
 */
export default function HeaderFavoritesLink({ token, variant = "header" }) {
  const router = useRouter();
  if (!token) return null;

  const active = router.pathname === "/favorites";

  if (variant === "dock") {
    return (
      <Link
        href="/favorites"
        className={`mobile-dock__item${active ? " mobile-dock__item--active" : ""}`}
        aria-current={active ? "page" : undefined}
        aria-label="Избранное"
      >
        <span className="mobile-dock__icon">{heartIcon}</span>
        <span className="mobile-dock__label">Избр.</span>
      </Link>
    );
  }

  return (
    <Link href="/favorites" className="header-favorites-link" aria-label="Избранное">
      <span className="header-favorites-link__icon" aria-hidden>
        {heartIcon}
      </span>
      <span className="header-favorites-link__label">Избранное</span>
    </Link>
  );
}
