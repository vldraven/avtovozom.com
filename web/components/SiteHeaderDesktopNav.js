import Link from "next/link";

import HeaderFavoritesLink from "./HeaderFavoritesLink";
import HeaderMessagesLink from "./HeaderMessagesLink";
import HeaderProfileLink from "./HeaderProfileLink";
import SiteHeaderPhoneLink from "./SiteHeaderPhoneLink";
import SiteLogo from "./SiteLogo";
import { canCreateListings } from "../lib/roles";

const NAV_LINKS = [
  { key: "catalog", href: "/catalog", label: "Каталог" },
  { key: "calculator", href: "/customs-calculator", label: "Калькулятор" },
  { key: "faq", href: "/faq", label: "FAQ" },
];

/**
 * Общий десктоп-хедер consumer-страниц (nav-ссылки + иконки чатов/избранного + профиль/вход).
 * Мобайл использует отдельный SiteHeader (с className="home-only-mobile" у вызывающей страницы).
 */
export default function SiteHeaderDesktopNav({ active, token, me }) {
  return (
    <header className="site-header home-only-desktop">
      <div className="container site-header__inner home-d-header">
        <SiteLogo />
        <nav className="home-d-nav" aria-label="Основная навигация">
          {NAV_LINKS.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={active === item.key ? "home-d-nav__link--active" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="home-d-header__actions">
          <SiteHeaderPhoneLink />
          <HeaderMessagesLink token={token} />
          <HeaderFavoritesLink token={token} />
          {!token ? (
            <>
              <Link href="/auth" className="btn home-d-btn-login">
                Войти
              </Link>
              <Link href="/auth" className="btn home-d-btn-register">
                Регистрация
              </Link>
            </>
          ) : (
            <>
              <HeaderProfileLink token={token} me={me} />
              {canCreateListings(me?.role) ? (
                <Link href="/staff/new-listing" className="btn btn-primary btn-sm home-d-btn-cta">
                  Добавить объявление
                </Link>
              ) : null}
            </>
          )}
        </div>
      </div>
    </header>
  );
}
