import Link from "next/link";
import { useRouter } from "next/router";

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

function profileFirstName(me) {
  const raw = String(me?.display_name || me?.full_name || "").trim();
  if (raw) return raw.split(/\s+/)[0];
  const email = String(me?.email || "").trim();
  if (email) return email.split("@")[0];
  return "Профиль";
}

function profileInitial(me) {
  const raw = String(me?.display_name || me?.full_name || me?.email || "П").trim();
  return (raw[0] || "П").toUpperCase();
}

/**
 * Ссылка «Профиль» в шапке.
 * На consumer-десктопе (макет 35) — чип с именем и инициалом.
 * variant="ghost" — текстовая кнопка для staff-шапок.
 */
export default function HeaderProfileLink({
  token,
  me = null,
  variant = "secondary",
  className = "",
  layout = "header",
}) {
  const router = useRouter();

  if (!token) return null;

  const active = router.pathname === "/profile";

  if (layout === "dock") {
    return (
      <Link
        href="/profile"
        className={`mobile-dock__item${active ? " mobile-dock__item--active" : ""}`}
        aria-current={active ? "page" : undefined}
        aria-label="Профиль"
      >
        <span className="mobile-dock__icon">{profileIcon}</span>
        <span className="mobile-dock__label">Профиль</span>
      </Link>
    );
  }

  if (variant === "ghost") {
    const base = `btn btn-ghost btn-sm header-profile-link ${className}`.trim();
    return (
      <Link href="/profile" className={base} aria-label="Профиль">
        Профиль
      </Link>
    );
  }

  const name = profileFirstName(me);
  const initial = profileInitial(me);
  const chipClass = `header-profile-chip ${className}`.trim();

  return (
    <Link href="/profile" className={chipClass} aria-label={`Профиль: ${name}`}>
      <span className="header-profile-chip__name">{name}</span>
      <span className="header-profile-chip__avatar" aria-hidden>
        {initial}
      </span>
    </Link>
  );
}
